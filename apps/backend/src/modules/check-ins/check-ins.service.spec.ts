import { ActorType, Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ChannelRouterService } from '../channels/channel-router.service';
import type { ChannelProvider, TemplatedMessage, VoiceScript } from '../channels/channel-provider';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { createRealAuditService } from '../../shared/testing/real-audit';
import {
  CHECK_IN_ALLOWED_FROM,
  CHECK_IN_ATTEMPT_ALLOWED_FROM,
  CheckInAlreadyScheduledError,
  OPEN_CHECK_IN_STATUSES,
} from './check-ins.repository';
import type {
  CheckInRecord,
  CheckInReceiverCandidate,
  CheckInsRepository,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
  MarkCheckInRespondedInput,
  CreateCheckInAttemptInput,
  CheckInAttemptRecord,
  CheckInAttemptWithCheckInRecord,
  ScheduleInvalidReceiver,
} from './check-ins.repository';
import { CheckInsService } from './check-ins.service';
import type { ResolveVoiceCallerIdInput, VoiceCallerIdRepository } from './voice-caller-id.repository';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryCheckInsRepository implements CheckInsRepository {
  public candidates: CheckInReceiverCandidate[] = [];
  public invalidSchedules: ScheduleInvalidReceiver[] = [];
  public created: CreatePendingCheckInInput[] = [];
  public sent: MarkCheckInSentInput[] = [];
  public attempts: CheckInAttemptRecord[] = [];
  public attemptsSent: string[] = [];
  public needsAttentionCheckInIds: string[] = [];
  /** Check-ins with explicit state; any other id behaves like a SENT check-in of receiver-1. */
  public checkIns = new Map<string, CheckInRecord>();
  /** Receivers the repository would report as valid again after a `scheduleInvalidAt` stamp (CB-069). */
  public recovered: string[] = [];
  /** `Receiver.scheduleInvalidAt` per receiver id (CB-069). */
  public scheduleInvalidAt = new Map<string, Date>();

  async findReceiversDueForCheckIn(_now: Date): Promise<{
    candidates: CheckInReceiverCandidate[];
    skipped: ScheduleInvalidReceiver[];
    recovered: string[];
  }> {
    return { candidates: this.candidates, skipped: this.invalidSchedules, recovered: this.recovered };
  }

  async markScheduleInvalid(input: { receiverId: string; seenAt: Date }): Promise<boolean> {
    if (this.scheduleInvalidAt.has(input.receiverId)) {
      return false;
    }
    this.scheduleInvalidAt.set(input.receiverId, input.seenAt);
    return true;
  }

  async clearScheduleInvalid(input: { receiverIds: string[] }): Promise<number> {
    return input.receiverIds.filter((receiverId) => this.scheduleInvalidAt.delete(receiverId)).length;
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    const scheduledLocalDate = input.scheduledLocalDate ?? input.scheduledAt.toISOString().slice(0, 10);
    // The partial unique index on (receiverId, scheduledLocalDate) WHERE retryOf IS NULL (CB-013).
    if (
      !input.retryOf &&
      [...this.checkIns.values()].some(
        (checkIn) =>
          checkIn.receiverId === input.receiverId &&
          checkIn.scheduledLocalDate === scheduledLocalDate &&
          !checkIn.retryOf,
      )
    ) {
      throw new CheckInAlreadyScheduledError(input.receiverId, scheduledLocalDate);
    }

    this.created.push(input);
    const checkIn: CheckInRecord = {
      id: `check-in-${this.created.length}`,
      receiverId: input.receiverId,
      scheduledAt: input.scheduledAt,
      scheduledLocalDate,
      retryOf: input.retryOf,
      status: CheckInStatus.PENDING,
      createdAt: input.scheduledAt,
      updatedAt: input.scheduledAt,
    };
    this.checkIns.set(checkIn.id, checkIn);

    return checkIn;
  }

  async markSent(input: MarkCheckInSentInput): Promise<boolean> {
    this.sent.push(input);
    return this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.sent, {
      status: CheckInStatus.SENT,
      channelUsed: input.channel,
      sentAt: input.sentAt,
    });
  }

  async findLatestOpenForReceiver(_receiverId: string): Promise<CheckInRecord | null> {
    return null;
  }

  async findOpenForReceiver(receiverId: string): Promise<CheckInRecord[]> {
    return [...this.checkIns.values()].filter(
      (checkIn) => checkIn.receiverId === receiverId && OPEN_CHECK_IN_STATUSES.includes(checkIn.status),
    );
  }

  async createAttempts(input: CreateCheckInAttemptInput[]): Promise<CheckInAttemptRecord[]> {
    const created = input.map((attempt, index) => ({
      id: `attempt-${this.attempts.length + index + 1}`,
      checkInId: attempt.checkInId,
      attemptNumber: attempt.attemptNumber,
      channel: attempt.channel,
      status: CheckInAttemptStatus.PENDING,
      scheduledAt: attempt.scheduledAt,
      createdAt: attempt.scheduledAt,
      updatedAt: attempt.scheduledAt,
    }));
    this.attempts.push(...created);
    return created;
  }

  async findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]> {
    return this.attempts
      .filter((attempt) => attempt.status === CheckInAttemptStatus.PENDING && attempt.scheduledAt <= input.now)
      .map((attempt) => this.withCheckIn(attempt));
  }

  async findTimedOutSentAttempts(_input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]> {
    return this.attempts
      .filter((attempt) => attempt.status === CheckInAttemptStatus.SENT)
      .map((attempt) => this.withCheckIn(attempt));
  }

  async markAttemptSent(input: {
    attemptId: string;
    sentAt: Date;
    providerMessageId: string;
    providerStatus: string;
  }): Promise<boolean> {
    this.attemptsSent.push(input.attemptId);
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.sent, {
      status: CheckInAttemptStatus.SENT,
      sentAt: input.sentAt,
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
      updatedAt: input.sentAt,
    });
  }

  async markAttemptFailed(input: { attemptId: string; completedAt: Date; failureReason: string }): Promise<boolean> {
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.failed, {
      status: CheckInAttemptStatus.FAILED,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      updatedAt: input.completedAt,
    });
  }

  async markSentAttemptProviderFailure(input: {
    providerMessageId: string;
    completedAt: Date;
    providerStatus: string;
    failureReason: string;
  }): Promise<CheckInAttemptRecord | null> {
    const attempt = [...this.attempts]
      .filter(
        (candidate) =>
          candidate.providerMessageId === input.providerMessageId && candidate.status === CheckInAttemptStatus.SENT,
      )
      .sort((left, right) => (right.sentAt?.getTime() ?? 0) - (left.sentAt?.getTime() ?? 0))[0];
    if (!attempt) {
      return null;
    }
    this.transitionAttempt(attempt.id, CHECK_IN_ATTEMPT_ALLOWED_FROM.providerFailure, {
      status: CheckInAttemptStatus.FAILED,
      completedAt: input.completedAt,
      providerStatus: input.providerStatus,
      failureReason: input.failureReason,
      updatedAt: input.completedAt,
    });
    return attempt;
  }

  async markAttemptTimedOut(input: { attemptId: string; completedAt: Date }): Promise<boolean> {
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.timedOut, {
      status: CheckInAttemptStatus.TIMED_OUT,
      completedAt: input.completedAt,
      failureReason: 'response_window_elapsed',
      updatedAt: input.completedAt,
    });
  }

  async markLatestSentAttemptResponded(input: {
    checkInId: string;
    completedAt: Date;
  }): Promise<CheckInAttemptRecord | null> {
    const attempt = [...this.attempts]
      .filter((candidate) => candidate.checkInId === input.checkInId && candidate.status === CheckInAttemptStatus.SENT)
      .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    if (!attempt) {
      return null;
    }
    this.transitionAttempt(attempt.id, CHECK_IN_ATTEMPT_ALLOWED_FROM.responded, {
      status: CheckInAttemptStatus.RESPONDED,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
    return attempt;
  }

  async skipPendingAttemptsForCheckIn(input: {
    checkInId: string;
    completedAt: Date;
    failureReason: string;
  }): Promise<number> {
    const attempts = this.attempts.filter(
      (attempt) => attempt.checkInId === input.checkInId && attempt.status === CheckInAttemptStatus.PENDING,
    );
    attempts.forEach((attempt) => {
      Object.assign(attempt, {
        status: CheckInAttemptStatus.SKIPPED,
        completedAt: input.completedAt,
        failureReason: input.failureReason,
        updatedAt: input.completedAt,
      });
    });
    return attempts.length;
  }

  async markNeedsAttention(input: { checkInId: string }): Promise<boolean> {
    const transitioned = this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.needsAttention, {
      status: CheckInStatus.NEEDS_ATTENTION,
    });
    if (transitioned) {
      this.needsAttentionCheckInIds.push(input.checkInId);
    }
    return transitioned;
  }

  async markCancelled(input: { checkInId: string }): Promise<boolean> {
    return this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.cancelled, { status: CheckInStatus.SKIPPED });
  }

  async findById(checkInId: string): Promise<CheckInRecord | null> {
    return this.checkInRecord(checkInId);
  }

  async findLatestActionableForReceiver(_receiverId: string): Promise<CheckInRecord | null> {
    return null;
  }

  async markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord | null> {
    const transitioned = this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.responded, {
      status: input.status,
      respondedAt: input.respondedAt,
      responseDetectedAs: input.responseDetectedAs,
      responseTranscript: input.responseTranscript,
    });
    return transitioned ? this.checkInRecord(input.checkInId) : null;
  }

  async markResolvedByBackupContact(input: { checkInId: string; resolvedAt: Date }): Promise<CheckInRecord | null> {
    const transitioned = this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.resolvedByBackupContact, {
      status: CheckInStatus.RESOLVED,
      resolvedAt: input.resolvedAt,
    });
    return transitioned ? this.checkInRecord(input.checkInId) : null;
  }

  checkInRecord(checkInId: string): CheckInRecord {
    return (
      this.checkIns.get(checkInId) ?? {
        id: checkInId,
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        status: CheckInStatus.SENT,
        createdAt: new Date('2026-04-27T05:30:00.000Z'),
        updatedAt: new Date('2026-04-27T05:30:00.000Z'),
      }
    );
  }

  private transitionCheckIn(
    checkInId: string,
    allowedFrom: readonly CheckInStatus[],
    patch: Partial<CheckInRecord>,
  ): boolean {
    const current = this.checkInRecord(checkInId);
    if (!allowedFrom.includes(current.status)) {
      return false;
    }
    this.checkIns.set(checkInId, { ...current, ...patch });
    return true;
  }

  private transitionAttempt(
    id: string,
    allowedFrom: readonly CheckInAttemptStatus[],
    patch: Partial<CheckInAttemptRecord>,
  ): boolean {
    const attempt = this.attempts.find((candidate) => candidate.id === id);
    if (!attempt) {
      throw new Error(`Attempt ${id} not found`);
    }
    if (!allowedFrom.includes(attempt.status)) {
      return false;
    }
    Object.assign(attempt, patch);
    return true;
  }

  private withCheckIn(attempt: CheckInAttemptRecord): CheckInAttemptWithCheckInRecord {
    return {
      ...attempt,
      checkIn: {
        ...this.checkInRecord(attempt.checkInId),
        receiverPhoneEncrypted: new CryptoService(masterKey).encrypt('+971501234567'),
        receiverCountryCode: 'AE',
        receiverLanguage: 'en',
      },
    };
  }
}

class InMemoryEscalationsService {
  public missedCheckIns: { receiverId: string; checkInId: string }[] = [];
  public nextError: Error | null = null;

  async notifySenderOfMissedCheckIn(input: { receiverId: string; checkInId: string }): Promise<void> {
    if (this.nextError) {
      throw this.nextError;
    }
    this.missedCheckIns.push(input);
  }
}

class InMemoryBillingService {
  public entitledByUserId = new Map<string, boolean>();
  public checkedUserIds: string[] = [];

  async getBillingStatus(userId: string) {
    this.checkedUserIds.push(userId);
    return {
      entitled: this.entitledByUserId.get(userId) ?? false,
      revenueCatAppUserId: userId,
      subscription: null,
    };
  }
}

class InMemoryVoiceCallerIds implements VoiceCallerIdRepository {
  public resolved: ResolveVoiceCallerIdInput[] = [];
  public callerIdByReceiverId = new Map<string, string | undefined>();

  async resolveForReceiver(input: ResolveVoiceCallerIdInput): Promise<string | undefined> {
    this.resolved.push(input);
    return this.callerIdByReceiverId.get(input.receiverId);
  }
}

/** A provider whose every send throws, like Twilio rejecting an unroutable number. */
class ThrowingChannelProvider implements ChannelProvider {
  public attempts = 0;

  constructor(public readonly channel: Channel) {}

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<never> {
    this.attempts += 1;
    throw new Error('provider unavailable');
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<never> {
    this.attempts += 1;
    throw new Error('provider unavailable');
  }

  async isAvailableForNumber(_phone: string): Promise<boolean> {
    return true;
  }
}

describe('CheckInsService', () => {
  it('creates, sends, marks sent, and audits a due receiver with granted consent', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      now: () => new Date('2026-04-27T05:30:00.000Z'),
    });
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.candidates = [receiverCandidate(crypto)];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 1, sent: 1, skipped: 0, failed: 0 });
    expect(repository.created).toEqual([
      {
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        scheduledLocalDate: '2026-04-27',
      },
    ]);
    expect(whatsapp.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'checkin_daily',
          language: 'en',
          variables: { receiverName: 'Fatima', senderDisplayName: 'your family member' },
        },
      },
    ]);
    expect(repository.sent).toEqual([
      {
        checkInId: 'check-in-1',
        channel: Channel.WHATSAPP,
        sentAt: new Date('2026-04-27T05:30:00.000Z'),
        providerMessageId: 'fake-WHATSAPP-message-1',
        providerStatus: 'accepted',
      },
    ]);
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.SENT);
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.created',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          scheduleFrequency: 'daily',
        },
      },
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          channel: Channel.WHATSAPP,
          providerStatus: 'accepted',
          renderedLanguage: 'en',
          renderFallback: false,
        },
      },
    ]);
  });

  it('sends human English copy with the personal note for a receiver whose language has no copy yet, and records the fallback', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-27T05:30:00.000Z'),
    });
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        language: 'ar',
        primaryChannel: Channel.SMS,
        personalNoteEncrypted: crypto.encrypt('Take your pills at 8'),
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    await service.sendDueCheckIns();

    expect(sms.sentMessages[0]?.message).toEqual({
      templateKey: 'checkin_daily',
      language: 'ar',
      variables: {
        receiverName: 'Fatima',
        senderDisplayName: 'your family member',
        personalNote: 'Take your pills at 8',
      },
    });
    expect(sms.renderedMessages).toEqual([
      {
        to: '+971501234567',
        templateKey: 'checkin_daily',
        language: 'en',
        fallback: true,
        body:
          'Hi Fatima, your family member is checking in on you today. Their note: "Take your pills at 8" ' +
          "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.",
      },
    ]);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'check_in.sent',
      metadata: { receiverId: 'receiver-1', channel: Channel.SMS, renderedLanguage: 'en', renderFallback: true },
    });
    expect(JSON.stringify(audit.events)).not.toContain('Take your pills');
    expect(JSON.stringify(audit.events)).not.toContain('Fatima');
  });

  it('skips candidates that are not currently eligible for a check-in', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    repository.candidates = [
      { ...receiverCandidate(crypto), id: 'pending-receiver', consentStatus: ConsentStatus.PENDING },
      { ...receiverCandidate(crypto), id: 'paused-receiver', pausedUntil: new Date('2026-04-28T00:00:00.000Z') },
      { ...receiverCandidate(crypto), id: 'deleted-receiver', deletedAt: new Date('2026-04-26T00:00:00.000Z') },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 0, sent: 0, skipped: 3, failed: 0 });
    expect(repository.created).toEqual([]);
    expect(repository.sent).toEqual([]);
    expect(whatsapp.sentMessages).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('skips due receivers whose sender does not have paid access', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const billing = new InMemoryBillingService();
    repository.candidates = [receiverCandidate(crypto)];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 0, sent: 0, skipped: 1, failed: 0 });
    expect(billing.checkedUserIds).toEqual(['sender-user-1']);
    expect(repository.created).toEqual([]);
    expect(repository.attempts).toEqual([]);
    expect(repository.sent).toEqual([]);
    expect(whatsapp.sentMessages).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('uses the sticky caller ID when sending an initial voice check-in', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    const billing = new InMemoryBillingService();
    const callerIds = new InMemoryVoiceCallerIds();
    billing.entitledByUserId.set('sender-user-1', true);
    callerIds.callerIdByReceiverId.set('receiver-1', '+15559990000');
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        techProfile: TechProfile.VOICE_ONLY,
        primaryChannel: Channel.VOICE,
        fallbackChannels: [],
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
      callerIds,
    );

    await service.sendDueCheckIns();

    expect(callerIds.resolved).toEqual([{ receiverId: 'receiver-1', countryCode: 'AE' }]);
    expect(voice.voiceCalls[0]?.options).toEqual({ fromNumber: '+15559990000' });
  });

  it('creates two scheduled voice retries for voice-only receivers', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        techProfile: TechProfile.VOICE_ONLY,
        primaryChannel: Channel.VOICE,
        fallbackChannels: [],
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    await service.sendDueCheckIns();

    expect(
      repository.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        channel: attempt.channel,
        scheduledAt: attempt.scheduledAt,
      })),
    ).toEqual([
      {
        attemptNumber: 1,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      },
      {
        attemptNumber: 2,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      },
      {
        attemptNumber: 3,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T06:15:00.000Z'),
      },
    ]);
    expect(repository.attemptsSent).toEqual(['attempt-1']);
    expect(voice.voiceCalls).toHaveLength(1);
  });

  it('does not send a retry attempt before its scheduled retry time', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    repository.attempts = [
      sentAttempt({ id: 'attempt-1', channel: Channel.VOICE, sentAt: new Date('2026-04-27T05:30:00.000Z') }),
      pendingAttempt({
        id: 'attempt-2',
        attemptNumber: 2,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T06:15:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T06:00:00.000Z'),
    );

    const result = await service.processCascadeAttempts();

    expect(result).toEqual({ sent: 0, timedOut: 1, failed: 0, needsAttention: 0, skipped: 0 });
    expect(repository.attemptsSent).toEqual([]);
    expect(repository.attempts[1]).toMatchObject({
      id: 'attempt-2',
      status: CheckInAttemptStatus.PENDING,
      scheduledAt: new Date('2026-04-27T06:15:00.000Z'),
    });
    expect(repository.needsAttentionCheckInIds).toEqual([]);
  });

  it('marks sent voice attempts failed from terminal Twilio provider callbacks', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    repository.attempts = [
      sentAttempt({ id: 'attempt-1', channel: Channel.VOICE, sentAt: new Date('2026-04-27T05:30:00.000Z') }),
      pendingAttempt({
        id: 'attempt-2',
        attemptNumber: 2,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:31:00.000Z'),
    );

    const result = await service.recordVoiceProviderFailure({
      providerMessageId: 'CA123',
      providerStatus: 'busy',
    });

    expect(result).toEqual({ updated: true });
    expect(repository.attempts[0]).toMatchObject({
      status: CheckInAttemptStatus.FAILED,
      providerStatus: 'busy',
      completedAt: new Date('2026-04-27T05:31:00.000Z'),
      failureReason: 'twilio_status_busy',
    });
    expect(repository.needsAttentionCheckInIds).toEqual([]);
  });

  it('marks the check-in needs attention and notifies the sender when the final voice attempt fails from a Twilio callback', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    const escalations = new InMemoryEscalationsService();
    repository.attempts = [
      sentAttempt({
        id: 'attempt-3',
        attemptNumber: 3,
        channel: Channel.VOICE,
        sentAt: new Date('2026-04-27T06:15:00.000Z'),
        providerMessageId: 'CA-final',
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      escalations,
      () => new Date('2026-04-27T06:16:00.000Z'),
    );

    const result = await service.recordVoiceProviderFailure({
      providerMessageId: 'CA-final',
      providerStatus: 'no-answer',
    });

    expect(result).toEqual({ updated: true });
    expect(repository.needsAttentionCheckInIds).toEqual(['check-in-1']);
    expect(escalations.missedCheckIns).toEqual([{ receiverId: 'receiver-1', checkInId: 'check-in-1' }]);
    expect(audit.events).toContainEqual(
      expect.objectContaining({
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.needs_attention',
        metadata: {
          receiverId: 'receiver-1',
          reason: 'cascade_exhausted',
        },
      }),
    );
  });

  it('falls back to configured voice caller ID when no sticky assignment is available', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    const billing = new InMemoryBillingService();
    const callerIds = new InMemoryVoiceCallerIds();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        techProfile: TechProfile.VOICE_ONLY,
        primaryChannel: Channel.VOICE,
        fallbackChannels: [],
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
      callerIds,
    );

    await service.sendDueCheckIns();

    expect(callerIds.resolved).toEqual([{ receiverId: 'receiver-1', countryCode: 'AE' }]);
    expect(voice.voiceCalls[0]?.options).toBeUndefined();
  });
});

describe('CheckInsService keeps the tick alive around bad rows and throwing providers (CB-004)', () => {
  it('audits an unevaluable schedule and a failed first send, counts both as failed, and still sends everyone else', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new ThrowingChannelProvider(Channel.SMS);
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, { now: () => new Date('2026-04-27T05:30:00.000Z') });
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.invalidSchedules = [{ receiverId: 'receiver-dubai', reason: 'invalid_timezone' }];
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        id: 'receiver-1',
        primaryChannel: Channel.SMS,
        fallbackChannels: [Channel.VOICE],
      },
      { ...receiverCandidate(crypto), id: 'receiver-2', phoneEncrypted: crypto.encrypt('+971507654321') },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, whatsapp]),
      auditService,
      new InMemoryEscalationsService(),
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 2, sent: 1, skipped: 0, failed: 2 });
    expect(sms.attempts).toBe(1);
    expect(whatsapp.sentMessages.map((sent) => sent.to)).toEqual(['+971507654321']);
    expect(repository.attempts.find((attempt) => attempt.checkInId === 'check-in-1')).toMatchObject({
      attemptNumber: 1,
      status: CheckInAttemptStatus.FAILED,
      failureReason: 'provider_send_failed',
      completedAt: new Date('2026-04-27T05:30:00.000Z'),
    });
    // The receiver still has a voice fallback scheduled, so the check-in stays open for the cascade.
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.PENDING);
    expect(repository.checkInRecord('check-in-2').status).toBe(CheckInStatus.SENT);
    expect(repository.needsAttentionCheckInIds).toEqual([]);
    expect(audit.events).toContainEqual({
      entityType: 'receiver',
      entityId: 'receiver-dubai',
      action: 'check_in.schedule_invalid',
      actorType: ActorType.SYSTEM,
      metadata: { receiverId: 'receiver-dubai', reason: 'invalid_timezone' },
    });
    expect(audit.events).toContainEqual({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.attempt_failed',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        channel: Channel.SMS,
        attemptNumber: 1,
        failureReason: 'provider_send_failed',
      },
    });
    expect(audit.events.filter((event) => event.action === 'check_in.sent').map((event) => event.entityId)).toEqual([
      'check-in-2',
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+9715');
  });

  it('flags the check-in and notifies the sender when the only attempt cannot be sent', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    repository.candidates = [{ ...receiverCandidate(crypto), primaryChannel: Channel.SMS, fallbackChannels: [] }];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([new ThrowingChannelProvider(Channel.SMS)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 1, sent: 0, skipped: 0, failed: 1 });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.NEEDS_ATTENTION);
    expect(escalations.missedCheckIns).toEqual([{ receiverId: 'receiver-1', checkInId: 'check-in-1' }]);
  });

  it('marks a cascade attempt failed and carries on with the other due attempts when its provider throws', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new ThrowingChannelProvider(Channel.SMS);
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    repository.attempts = [
      pendingAttempt({
        id: 'attempt-2',
        checkInId: 'check-in-1',
        attemptNumber: 2,
        channel: Channel.SMS,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
      pendingAttempt({
        id: 'attempt-3',
        checkInId: 'check-in-1',
        attemptNumber: 3,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T06:30:00.000Z'),
      }),
      pendingAttempt({
        id: 'attempt-9',
        checkInId: 'check-in-2',
        attemptNumber: 1,
        channel: Channel.WHATSAPP,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, whatsapp]),
      auditService,
      new InMemoryEscalationsService(),
      () => new Date('2026-04-27T05:46:00.000Z'),
    );

    const result = await service.processCascadeAttempts();

    expect(result).toEqual({ sent: 1, timedOut: 0, failed: 1, needsAttention: 0, skipped: 0 });
    expect(repository.attempts[0]).toMatchObject({
      id: 'attempt-2',
      status: CheckInAttemptStatus.FAILED,
      failureReason: 'provider_send_failed',
    });
    expect(repository.attempts[1]).toMatchObject({ id: 'attempt-3', status: CheckInAttemptStatus.PENDING });
    expect(repository.attempts[2]).toMatchObject({ id: 'attempt-9', status: CheckInAttemptStatus.SENT });
    expect(repository.needsAttentionCheckInIds).toEqual([]);
    expect(audit.events.map((event) => event.action)).toEqual(['check_in.attempt_failed']);
  });
});

describe('CheckInsService notifies the sender once when a cascade is exhausted (CB-005)', () => {
  it('flags NEEDS_ATTENTION and notifies the sender when the last attempt times out, and not again on the next tick', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    repository.attempts = [
      sentAttempt({
        id: 'attempt-3',
        attemptNumber: 3,
        channel: Channel.VOICE,
        sentAt: new Date('2026-04-27T06:15:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([new FakeChannelProvider(Channel.VOICE)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T06:46:00.000Z'),
    );

    const firstTick = await service.processCascadeAttempts();
    const secondTick = await service.processCascadeAttempts();

    expect(firstTick).toEqual({ sent: 0, timedOut: 1, failed: 0, needsAttention: 1, skipped: 0 });
    expect(secondTick).toEqual({ sent: 0, timedOut: 0, failed: 0, needsAttention: 0, skipped: 0 });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.NEEDS_ATTENTION);
    expect(escalations.missedCheckIns).toEqual([{ receiverId: 'receiver-1', checkInId: 'check-in-1' }]);
    expect(audit.events.filter((event) => event.action === 'check_in.needs_attention')).toHaveLength(1);
  });

  it('audits a sender notification that throws and still completes the tick', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    escalations.nextError = new Error('owner lookup failed');
    repository.attempts = [
      sentAttempt({
        id: 'attempt-3',
        attemptNumber: 3,
        channel: Channel.VOICE,
        sentAt: new Date('2026-04-27T06:15:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([new FakeChannelProvider(Channel.VOICE)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T06:46:00.000Z'),
    );

    const result = await service.processCascadeAttempts();

    expect(result).toEqual({ sent: 0, timedOut: 1, failed: 0, needsAttention: 1, skipped: 0 });
    expect(audit.events.map((event) => event.action)).toEqual([
      'check_in.needs_attention',
      'check_in.sender_notify_failed',
    ]);
    expect(audit.events[1]?.metadata).toEqual({ receiverId: 'receiver-1', reason: 'cascade_exhausted' });
  });
});

describe('CheckInsService never reopens or downgrades a closed check-in (CB-006)', () => {
  it('records a late no-answer callback on the attempt but leaves a check-in answered OK alone', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    repository.checkIns.set('check-in-1', {
      ...repository.checkInRecord('check-in-1'),
      status: CheckInStatus.RESPONDED_OK,
      respondedAt: new Date('2026-04-27T06:20:00.000Z'),
    });
    repository.attempts = [
      sentAttempt({
        id: 'attempt-3',
        attemptNumber: 3,
        channel: Channel.VOICE,
        sentAt: new Date('2026-04-27T06:15:00.000Z'),
        providerMessageId: 'CA-final',
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([new FakeChannelProvider(Channel.VOICE)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T06:25:00.000Z'),
    );

    const result = await service.recordVoiceProviderFailure({
      providerMessageId: 'CA-final',
      providerStatus: 'no-answer',
    });

    expect(result).toEqual({ updated: true });
    expect(repository.attempts[0]).toMatchObject({
      status: CheckInAttemptStatus.FAILED,
      failureReason: 'twilio_status_no-answer',
    });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.RESPONDED_OK);
    expect(repository.needsAttentionCheckInIds).toEqual([]);
    expect(escalations.missedCheckIns).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('skips a late fallback attempt instead of sending it once the check-in was resolved', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    const sms = new FakeChannelProvider(Channel.SMS);
    repository.checkIns.set('check-in-1', {
      ...repository.checkInRecord('check-in-1'),
      status: CheckInStatus.RESOLVED,
      resolvedAt: new Date('2026-04-27T05:40:00.000Z'),
    });
    repository.attempts = [
      sentAttempt({ id: 'attempt-1', channel: Channel.WHATSAPP, sentAt: new Date('2026-04-27T05:30:00.000Z') }),
      pendingAttempt({
        id: 'attempt-2',
        attemptNumber: 2,
        channel: Channel.SMS,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, new FakeChannelProvider(Channel.WHATSAPP)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T05:46:00.000Z'),
    );

    const result = await service.processCascadeAttempts();

    expect(result).toEqual({ sent: 0, timedOut: 1, failed: 0, needsAttention: 0, skipped: 1 });
    expect(sms.sentMessages).toEqual([]);
    expect(repository.attempts[1]).toMatchObject({
      id: 'attempt-2',
      status: CheckInAttemptStatus.SKIPPED,
      failureReason: 'cascade_closed',
    });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.RESOLVED);
    expect(escalations.missedCheckIns).toEqual([]);
    expect(audit.events).toEqual([]);
  });
});

describe('CheckInsService cancels open check-ins for a receiver (CB-008)', () => {
  it('skips the pending attempts and closes the open check-ins of that receiver only, then sends nothing further', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    const sms = new FakeChannelProvider(Channel.SMS);
    repository.checkIns.set('check-in-1', { ...repository.checkInRecord('check-in-1'), receiverId: 'receiver-1' });
    repository.checkIns.set('check-in-2', { ...repository.checkInRecord('check-in-2'), receiverId: 'receiver-2' });
    repository.checkIns.set('check-in-3', {
      ...repository.checkInRecord('check-in-3'),
      receiverId: 'receiver-1',
      status: CheckInStatus.RESPONDED_OK,
    });
    repository.attempts = [
      sentAttempt({ id: 'attempt-1', channel: Channel.WHATSAPP, sentAt: new Date('2026-04-27T05:30:00.000Z') }),
      pendingAttempt({
        id: 'attempt-2',
        attemptNumber: 2,
        channel: Channel.SMS,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
      pendingAttempt({
        id: 'attempt-9',
        checkInId: 'check-in-2',
        attemptNumber: 2,
        channel: Channel.SMS,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, new FakeChannelProvider(Channel.WHATSAPP)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T05:40:00.000Z'),
    );

    const cancelled = await service.cancelOpenCheckInsForReceiver({
      receiverId: 'receiver-1',
      reason: 'receiver_opted_out',
    });

    expect(cancelled).toEqual({ cancelled: 1, skippedAttempts: 1 });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.SKIPPED);
    expect(repository.checkInRecord('check-in-2').status).toBe(CheckInStatus.SENT);
    expect(repository.checkInRecord('check-in-3').status).toBe(CheckInStatus.RESPONDED_OK);
    expect(repository.attempts[0]).toMatchObject({ id: 'attempt-1', status: CheckInAttemptStatus.SENT });
    expect(repository.attempts[1]).toMatchObject({
      id: 'attempt-2',
      status: CheckInAttemptStatus.SKIPPED,
      failureReason: 'receiver_opted_out',
      completedAt: new Date('2026-04-27T05:40:00.000Z'),
    });
    expect(repository.attempts[2]).toMatchObject({ id: 'attempt-9', status: CheckInAttemptStatus.PENDING });
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.cancelled',
        actorType: ActorType.SYSTEM,
        metadata: { receiverId: 'receiver-1', reason: 'receiver_opted_out', skippedAttempts: 1 },
      },
    ]);

    // The next tick: attempt 1 times out, but the cancelled check-in gets no fallback and no siren.
    const laterService = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, new FakeChannelProvider(Channel.WHATSAPP)]),
      auditService,
      escalations,
      () => new Date('2026-04-27T05:46:00.000Z'),
    );
    const tick = await laterService.processCascadeAttempts();

    expect(tick).toEqual({ sent: 1, timedOut: 1, failed: 0, needsAttention: 0, skipped: 0 });
    expect(sms.sentMessages).toHaveLength(1);
    expect(repository.attempts[2]).toMatchObject({ id: 'attempt-9', status: CheckInAttemptStatus.SENT });
    expect(repository.attempts[0]).toMatchObject({ id: 'attempt-1', status: CheckInAttemptStatus.TIMED_OUT });
    expect(repository.checkInRecord('check-in-1').status).toBe(CheckInStatus.SKIPPED);
    expect(escalations.missedCheckIns).toEqual([]);
  });

  it('is a no-op for a receiver with nothing open', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const service = new CheckInsService(repository, crypto, new ChannelRouterService([]), auditService);

    await expect(
      service.cancelOpenCheckInsForReceiver({ receiverId: 'receiver-1', reason: 'receiver_paused' }),
    ).resolves.toEqual({
      cancelled: 0,
      skippedAttempts: 0,
    });
    expect(audit.events).toEqual([]);
  });
});

describe('CheckInsService dedupes on the receiver local day (CB-013)', () => {
  it('stores the local day the repository evaluated and skips a receiver whose day an overlapping tick already claimed', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const billing = new InMemoryBillingService();
    billing.entitledByUserId.set('sender-user-1', true);
    // 16:30 in Los Angeles on 5 September is already 6 September in UTC; the day comes from the repository, not the clock.
    repository.candidates = [
      {
        ...receiverCandidate(crypto),
        id: 'receiver-la',
        timezone: 'America/Los_Angeles',
        scheduleTimeWindow: { start: '16:00', end: '18:00' },
        scheduledLocalDate: '2026-09-05',
      },
      {
        ...receiverCandidate(crypto),
        id: 'receiver-claimed',
        phoneEncrypted: crypto.encrypt('+971507654321'),
        scheduledLocalDate: '2026-09-06',
      },
    ];
    // Another tick inserted receiver-claimed's check-in for 6 September between our lookup and our insert.
    repository.checkIns.set('check-in-other-tick', {
      ...repository.checkInRecord('check-in-other-tick'),
      receiverId: 'receiver-claimed',
      scheduledLocalDate: '2026-09-06',
    });
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      auditService,
      undefined,
      () => new Date('2026-09-05T23:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 1, sent: 1, skipped: 1, failed: 0 });
    expect(repository.created).toEqual([
      {
        receiverId: 'receiver-la',
        scheduledAt: new Date('2026-09-05T23:30:00.000Z'),
        scheduledLocalDate: '2026-09-05',
      },
    ]);
    expect(repository.checkInRecord('check-in-1')).toMatchObject({
      receiverId: 'receiver-la',
      scheduledLocalDate: '2026-09-05',
      retryOf: undefined,
      status: CheckInStatus.SENT,
    });
    expect(whatsapp.sentMessages.map((sent) => sent.to)).toEqual(['+971501234567']);
    expect(audit.events.map((event) => [event.action, event.entityId])).toEqual([
      ['check_in.created', 'check-in-1'],
      ['check_in.sent', 'check-in-1'],
    ]);
  });
});

describe('CheckInsService audits an invalid schedule once per schedule version (CB-069)', () => {
  it('writes one check_in.schedule_invalid row across ticks, keeps counting the row as failed, and audits again only after the schedule recovered', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    repository.invalidSchedules = [{ receiverId: 'receiver-dubai', reason: 'invalid_timezone' }];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([]),
      auditService,
      undefined,
      () => new Date('2026-09-06T08:00:00.000Z'),
    );

    expect(await service.sendDueCheckIns()).toEqual({ created: 0, sent: 0, skipped: 0, failed: 1 });
    expect(await service.sendDueCheckIns()).toEqual({ created: 0, sent: 0, skipped: 0, failed: 1 });
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: 'receiver-dubai',
        action: 'check_in.schedule_invalid',
        actorType: ActorType.SYSTEM,
        metadata: { receiverId: 'receiver-dubai', reason: 'invalid_timezone' },
      },
    ]);
    expect(repository.scheduleInvalidAt.get('receiver-dubai')).toEqual(new Date('2026-09-06T08:00:00.000Z'));

    // The sender fixes the timezone: the next tick reports the receiver as recovered and the stamp is cleared.
    repository.invalidSchedules = [];
    repository.recovered = ['receiver-dubai'];
    expect(await service.sendDueCheckIns()).toEqual({ created: 0, sent: 0, skipped: 0, failed: 0 });
    expect(repository.scheduleInvalidAt.has('receiver-dubai')).toBe(false);

    // A second bad version is a new event.
    repository.invalidSchedules = [{ receiverId: 'receiver-dubai', reason: 'invalid_schedule_time_window' }];
    repository.recovered = [];
    await service.sendDueCheckIns();
    await service.sendDueCheckIns();
    expect(audit.events.map((event) => event.metadata)).toEqual([
      { receiverId: 'receiver-dubai', reason: 'invalid_timezone' },
      { receiverId: 'receiver-dubai', reason: 'invalid_schedule_time_window' },
    ]);
  });
});

describe('CheckInsService renders checkin_retry for later attempts of a check-in (CB-010)', () => {
  it('sends checkin_daily on attempt 1 and checkin_retry with the same variables from attempt 2, while voice keeps its script', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const { auditService } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS);
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const voice = new FakeChannelProvider(Channel.VOICE);
    repository.attempts = [
      pendingAttempt({
        id: 'attempt-1',
        checkInId: 'check-in-retry-later',
        attemptNumber: 1,
        channel: Channel.WHATSAPP,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
      pendingAttempt({
        id: 'attempt-2',
        checkInId: 'check-in-1',
        attemptNumber: 2,
        channel: Channel.SMS,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
      pendingAttempt({
        id: 'attempt-3',
        checkInId: 'check-in-2',
        attemptNumber: 3,
        channel: Channel.VOICE,
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
      }),
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([sms, whatsapp, voice]),
      auditService,
      undefined,
      () => new Date('2026-04-27T05:46:00.000Z'),
    );

    const result = await service.processCascadeAttempts();

    expect(result).toEqual({ sent: 3, timedOut: 0, failed: 0, needsAttention: 0, skipped: 0 });
    expect(whatsapp.sentMessages[0]?.message).toEqual({
      templateKey: 'checkin_daily',
      language: 'en',
      variables: { receiverName: 'there', senderDisplayName: 'your family member' },
    });
    expect(sms.sentMessages[0]?.message).toEqual({
      templateKey: 'checkin_retry',
      language: 'en',
      variables: { receiverName: 'there', senderDisplayName: 'your family member' },
    });
    expect(sms.renderedMessages[0]?.body).toMatch(/^Hi there, we have not heard back from you yet\./);
    expect(voice.voiceCalls[0]?.script).toMatchObject({ scriptKey: 'checkin_daily_voice', language: 'en' });
  });
});

function receiverCandidate(crypto: CryptoService): CheckInReceiverCandidate {
  return {
    id: 'receiver-1',
    userId: 'sender-user-1',
    nameEncrypted: crypto.encrypt('Fatima'),
    phoneEncrypted: crypto.encrypt('+971501234567'),
    countryCode: 'AE',
    language: 'en',
    timezone: 'Asia/Dubai',
    techProfile: TechProfile.WHATSAPP,
    primaryChannel: Channel.WHATSAPP,
    fallbackChannels: [Channel.SMS, Channel.VOICE],
    scheduleFrequency: 'daily',
    scheduleTimeWindow: {
      start: '09:00',
      end: '11:00',
    },
    consentStatus: ConsentStatus.GRANTED,
    scheduledLocalDate: '2026-04-27',
  };
}

function sentAttempt(input: {
  id: string;
  checkInId?: string;
  attemptNumber?: number;
  channel: Channel;
  sentAt: Date;
  providerMessageId?: string;
}): CheckInAttemptRecord {
  return {
    id: input.id,
    checkInId: input.checkInId ?? 'check-in-1',
    attemptNumber: input.attemptNumber ?? 1,
    channel: input.channel,
    status: CheckInAttemptStatus.SENT,
    scheduledAt: input.sentAt,
    sentAt: input.sentAt,
    providerMessageId: input.providerMessageId ?? 'CA123',
    providerStatus: 'queued',
    createdAt: input.sentAt,
    updatedAt: input.sentAt,
  };
}

function pendingAttempt(input: {
  id: string;
  checkInId?: string;
  attemptNumber: number;
  channel: Channel;
  scheduledAt: Date;
}): CheckInAttemptRecord {
  return {
    id: input.id,
    checkInId: input.checkInId ?? 'check-in-1',
    attemptNumber: input.attemptNumber,
    channel: input.channel,
    status: CheckInAttemptStatus.PENDING,
    scheduledAt: input.scheduledAt,
    createdAt: new Date('2026-04-27T05:30:00.000Z'),
    updatedAt: new Date('2026-04-27T05:30:00.000Z'),
  };
}
