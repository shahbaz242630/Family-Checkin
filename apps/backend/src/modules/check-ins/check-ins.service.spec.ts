import { ActorType, Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type {
  CheckInRecord,
  CheckInReceiverCandidate,
  CheckInsRepository,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
  MarkCheckInRespondedInput,
  FindOverdueSentCheckInsInput,
  CreateCheckInAttemptInput,
  CheckInAttemptRecord,
  CheckInAttemptWithCheckInRecord,
} from './check-ins.repository';
import { CheckInsService } from './check-ins.service';
import type { ResolveVoiceCallerIdInput, VoiceCallerIdRepository } from './voice-caller-id.repository';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryCheckInsRepository implements CheckInsRepository {
  public candidates: CheckInReceiverCandidate[] = [];
  public overdueCheckIns: CheckInRecord[] = [];
  public overdueQueries: FindOverdueSentCheckInsInput[] = [];
  public created: CreatePendingCheckInInput[] = [];
  public sent: MarkCheckInSentInput[] = [];
  public attempts: CheckInAttemptRecord[] = [];
  public attemptsSent: string[] = [];
  public needsAttentionCheckInIds: string[] = [];

  async findReceiversDueForCheckIn(_now: Date): Promise<CheckInReceiverCandidate[]> {
    return this.candidates;
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    this.created.push(input);

    return {
      id: `check-in-${this.created.length}`,
      receiverId: input.receiverId,
      scheduledAt: input.scheduledAt,
      status: CheckInStatus.PENDING,
      createdAt: input.scheduledAt,
      updatedAt: input.scheduledAt,
    };
  }

  async markSent(input: MarkCheckInSentInput): Promise<CheckInRecord> {
    this.sent.push(input);

    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.SENT,
      channelUsed: input.channel,
      sentAt: input.sentAt,
      createdAt: input.sentAt,
      updatedAt: input.sentAt,
    };
  }

  async findLatestOpenForReceiver(_receiverId: string): Promise<CheckInRecord | null> {
    return null;
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
  }): Promise<CheckInAttemptRecord> {
    this.attemptsSent.push(input.attemptId);
    return this.updateAttempt(input.attemptId, {
      status: CheckInAttemptStatus.SENT,
      sentAt: input.sentAt,
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
      updatedAt: input.sentAt,
    });
  }

  async markAttemptFailed(input: { attemptId: string; completedAt: Date; failureReason: string }): Promise<CheckInAttemptRecord> {
    return this.updateAttempt(input.attemptId, {
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
    return this.updateAttempt(attempt.id, {
      status: CheckInAttemptStatus.FAILED,
      completedAt: input.completedAt,
      providerStatus: input.providerStatus,
      failureReason: input.failureReason,
      updatedAt: input.completedAt,
    });
  }

  async markAttemptTimedOut(input: { attemptId: string; completedAt: Date }): Promise<CheckInAttemptRecord> {
    return this.updateAttempt(input.attemptId, {
      status: CheckInAttemptStatus.TIMED_OUT,
      completedAt: input.completedAt,
      failureReason: 'response_window_elapsed',
      updatedAt: input.completedAt,
    });
  }

  async markLatestSentAttemptResponded(input: { checkInId: string; completedAt: Date }): Promise<CheckInAttemptRecord | null> {
    const attempt = [...this.attempts]
      .filter((candidate) => candidate.checkInId === input.checkInId && candidate.status === CheckInAttemptStatus.SENT)
      .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    if (!attempt) {
      return null;
    }
    return this.updateAttempt(attempt.id, {
      status: CheckInAttemptStatus.RESPONDED,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
  }

  async skipPendingAttemptsForCheckIn(input: { checkInId: string; completedAt: Date; failureReason: string }): Promise<number> {
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

  async markNeedsAttention(input: { checkInId: string }): Promise<CheckInRecord> {
    this.needsAttentionCheckInIds.push(input.checkInId);
    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.NEEDS_ATTENTION,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:30:00.000Z'),
    };
  }

  async findById(checkInId: string): Promise<CheckInRecord | null> {
    return {
      id: checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.SENT,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:30:00.000Z'),
    };
  }

  async findLatestActionableForReceiver(_receiverId: string): Promise<CheckInRecord | null> {
    return null;
  }

  async markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord> {
    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: input.status,
      respondedAt: input.respondedAt,
      responseDetectedAs: input.responseDetectedAs,
      responseTranscript: input.responseTranscript,
      createdAt: input.respondedAt,
      updatedAt: input.respondedAt,
    };
  }

  async markResolvedByBackupContact(input: { checkInId: string; resolvedAt: Date }): Promise<CheckInRecord> {
    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.RESOLVED,
      resolvedAt: input.resolvedAt,
      createdAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
    };
  }

  async findOverdueSentCheckIns(input: FindOverdueSentCheckInsInput): Promise<CheckInRecord[]> {
    this.overdueQueries.push(input);
    return this.overdueCheckIns;
  }

  private updateAttempt(id: string, patch: Partial<CheckInAttemptRecord>): CheckInAttemptRecord {
    const attempt = this.attempts.find((candidate) => candidate.id === id);
    if (!attempt) {
      throw new Error(`Attempt ${id} not found`);
    }
    Object.assign(attempt, patch);
    return attempt;
  }

  private withCheckIn(attempt: CheckInAttemptRecord): CheckInAttemptWithCheckInRecord {
    return {
      ...attempt,
      checkIn: {
        id: attempt.checkInId,
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        status: CheckInStatus.SENT,
        createdAt: new Date('2026-04-27T05:30:00.000Z'),
        updatedAt: new Date('2026-04-27T05:30:00.000Z'),
        receiverPhoneEncrypted: new CryptoService(masterKey).encrypt('+971501234567'),
        receiverCountryCode: 'AE',
        receiverLanguage: 'en',
      },
    };
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      ...input,
    };
  }
}

class InMemoryEscalationsService {
  public nextStatus: CheckInStatus = CheckInStatus.ESCALATED;
  public missedEscalations: {
    receiverId: string;
    checkInId: string;
    sentAt: Date;
    responseWindowMinutes: number;
  }[] = [];

  async escalateMissedCheckIn(input: {
    receiverId: string;
    checkInId: string;
    sentAt: Date;
    responseWindowMinutes: number;
  }): Promise<{ checkInId: string; status: CheckInStatus; attempted: number; succeeded: number; failed: number }> {
    this.missedEscalations.push(input);
    return {
      checkInId: input.checkInId,
      status: this.nextStatus,
      attempted: this.nextStatus === CheckInStatus.SKIPPED ? 0 : 1,
      succeeded: this.nextStatus === CheckInStatus.ESCALATED ? 1 : 0,
      failed: this.nextStatus === CheckInStatus.FAILED ? 1 : 0,
    };
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

describe('CheckInsService', () => {
  it('creates, sends, marks sent, and audits a due receiver with granted consent', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 1, sent: 1, skipped: 0 });
    expect(repository.created).toEqual([
      {
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      },
    ]);
    expect(whatsapp.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'checkin_daily',
          language: 'en',
          variables: {},
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
        },
      },
    ]);
  });

  it('skips candidates that are not currently eligible for a check-in', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 0, sent: 0, skipped: 3 });
    expect(repository.created).toEqual([]);
    expect(repository.sent).toEqual([]);
    expect(whatsapp.sentMessages).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('skips due receivers whose sender does not have paid access', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const billing = new InMemoryBillingService();
    repository.candidates = [receiverCandidate(crypto)];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 0, sent: 0, skipped: 1 });
    expect(billing.checkedUserIds).toEqual(['sender-user-1']);
    expect(repository.created).toEqual([]);
    expect(repository.attempts).toEqual([]);
    expect(repository.sent).toEqual([]);
    expect(whatsapp.sentMessages).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('delegates overdue sent check-ins after the 30 minute response window', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const escalations = new InMemoryEscalationsService();
    repository.overdueCheckIns = [
      {
        id: 'check-in-overdue',
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-29T09:55:00.000Z'),
        status: CheckInStatus.SENT,
        channelUsed: Channel.WHATSAPP,
        sentAt: new Date('2026-04-29T10:00:00.000Z'),
        createdAt: new Date('2026-04-29T09:55:00.000Z'),
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      escalations,
      () => new Date('2026-04-29T10:31:00.000Z'),
    );

    const result = await service.escalateOverdueCheckIns();

    expect(repository.overdueQueries).toEqual([
      {
        overdueBefore: new Date('2026-04-29T10:01:00.000Z'),
      },
    ]);
    expect(escalations.missedEscalations).toEqual([
      {
        receiverId: 'receiver-1',
        checkInId: 'check-in-overdue',
        sentAt: new Date('2026-04-29T10:00:00.000Z'),
        responseWindowMinutes: 30,
      },
    ]);
    expect(result).toEqual({
      checked: 1,
      escalated: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it('counts terminal missed escalation failures separately from skipped outcomes', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const escalations = new InMemoryEscalationsService();
    escalations.nextStatus = CheckInStatus.FAILED;
    repository.overdueCheckIns = [
      {
        id: 'check-in-overdue',
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-29T09:55:00.000Z'),
        status: CheckInStatus.SENT,
        channelUsed: Channel.WHATSAPP,
        sentAt: new Date('2026-04-29T10:00:00.000Z'),
        createdAt: new Date('2026-04-29T09:55:00.000Z'),
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      escalations,
      () => new Date('2026-04-29T10:31:00.000Z'),
    );

    const result = await service.escalateOverdueCheckIns();

    expect(result).toEqual({
      checked: 1,
      escalated: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it('uses the sticky caller ID when sending an initial voice check-in', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
      undefined,
      () => new Date('2026-04-27T05:30:00.000Z'),
      billing,
    );

    await service.sendDueCheckIns();

    expect(repository.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      channel: attempt.channel,
      scheduledAt: attempt.scheduledAt,
    }))).toEqual([
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

  it('marks sent voice attempts failed from terminal Twilio provider callbacks', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    repository.attempts = [
      {
        id: 'attempt-1',
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.VOICE,
        status: CheckInAttemptStatus.SENT,
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        sentAt: new Date('2026-04-27T05:30:00.000Z'),
        providerMessageId: 'CA123',
        providerStatus: 'queued',
        createdAt: new Date('2026-04-27T05:30:00.000Z'),
        updatedAt: new Date('2026-04-27T05:30:00.000Z'),
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      audit as unknown as AuditService,
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
  });

  it('marks the check-in needs attention when the final voice attempt fails from Twilio callback', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const voice = new FakeChannelProvider(Channel.VOICE);
    repository.attempts = [
      {
        id: 'attempt-3',
        checkInId: 'check-in-1',
        attemptNumber: 3,
        channel: Channel.VOICE,
        status: CheckInAttemptStatus.SENT,
        scheduledAt: new Date('2026-04-27T06:15:00.000Z'),
        sentAt: new Date('2026-04-27T06:15:00.000Z'),
        providerMessageId: 'CA-final',
        providerStatus: 'queued',
        createdAt: new Date('2026-04-27T06:15:00.000Z'),
        updatedAt: new Date('2026-04-27T06:15:00.000Z'),
      },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      audit as unknown as AuditService,
      undefined,
      () => new Date('2026-04-27T06:16:00.000Z'),
    );

    const result = await service.recordVoiceProviderFailure({
      providerMessageId: 'CA-final',
      providerStatus: 'no-answer',
    });

    expect(result).toEqual({ updated: true });
    expect(repository.needsAttentionCheckInIds).toEqual(['check-in-1']);
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
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
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

function receiverCandidate(crypto: CryptoService): CheckInReceiverCandidate {
  return {
    id: 'receiver-1',
    userId: 'sender-user-1',
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
  };
}
