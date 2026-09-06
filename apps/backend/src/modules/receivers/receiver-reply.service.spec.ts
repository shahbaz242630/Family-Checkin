import {
  AbuseReportStatus,
  ActorType,
  Channel,
  CheckInAttemptStatus,
  CheckInStatus,
  ConsentStatus,
  EscalationResult,
  RelationshipType,
  TechProfile,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { BackupContactRecord, BackupContactsRepository } from '../backup-contacts/backup-contacts.repository';
import { ChannelRouterService } from '../channels/channel-router.service';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import type {
  CreateEscalationEventInput,
  EscalationBackupContactRecord,
  EscalationEventRecord,
  EscalationsRepository,
} from '../escalations/escalations.repository';
import { EscalationsService } from '../escalations/escalations.service';
import type { CheckInsService } from '../check-ins/check-ins.service';
import type {
  CheckInRecord,
  CheckInsRepository,
  CheckInReceiverCandidate,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
  ResolveCheckInByBackupContactInput,
} from '../check-ins/check-ins.repository';
import type { SendUserPushInput, SendUserPushResult } from '../notifications/notifications.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { createRealAuditService } from '../../shared/testing/real-audit';
import type {
  CreateReceiverRecordInput,
  OptOutCooldownRecord,
  ReceiverRecord,
  ReceiversRepository,
  UpdateReceiverRecordInput,
} from './receivers.repository';
import { ReceiverReplyService } from './receiver-reply.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public records: ReceiverRecord[] = [];
  /** The row `findActiveByPhoneHash` hands back; defaults to the first record for the hash. */
  public replyTarget: ReceiverRecord | null = null;
  public consentUpdate: {
    receiverId: string;
    consentStatus: ConsentStatus;
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  } | null = null;
  public consentUpdates: Array<{ receiverId: string; consentStatus: ConsentStatus }> = [];
  public abuseReport: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  } | null = null;
  public pausedReceiver: { receiverId: string; pausedReason: string } | null = null;
  public optOutCooldown: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  } | null = null;
  public optOutCooldowns: string[] = [];
  public activeCooldown: OptOutCooldownRecord | null = null;
  public resolutionNotes: Array<{ checkInId: string; resolutionNote: string }> = [];

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    const record = {
      id: 'receiver-1',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
    this.records.push(record);
    return record;
  }

  async findActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord | null> {
    if (this.replyTarget?.phoneHash === phoneHash) {
      return this.replyTarget;
    }
    return this.records.find((receiver) => receiver.phoneHash === phoneHash && !receiver.deletedAt) ?? null;
  }

  async findManyActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord[]> {
    return this.records.filter((receiver) => receiver.phoneHash === phoneHash && !receiver.deletedAt);
  }

  async findActiveById(receiverId: string): Promise<ReceiverRecord | null> {
    return this.records.find((receiver) => receiver.id === receiverId && !receiver.deletedAt) ?? null;
  }

  async findOptOutCooldownByPhoneHash(_phoneHash: string): Promise<OptOutCooldownRecord | null> {
    return this.activeCooldown;
  }

  async setCheckInResolutionNote(input: { checkInId: string; resolutionNote: string }): Promise<void> {
    this.resolutionNotes.push(input);
  }

  async findManyForUser(_userId: string): Promise<ReceiverRecord[]> {
    return [];
  }

  async findForUserById(input: { receiverId: string }): Promise<ReceiverRecord | null> {
    return this.records.find((receiver) => receiver.id === input.receiverId) ?? null;
  }

  async updateForUserById(input: UpdateReceiverRecordInput): Promise<ReceiverRecord | null> {
    const record = this.records.find(
      (receiver) => receiver.id === input.receiverId && receiver.userId === input.userId,
    );
    return record
      ? {
          ...record,
          nameEncrypted: input.nameEncrypted,
          countryCode: input.countryCode,
          relationshipType: input.relationshipType,
          language: input.language,
          timezone: input.timezone,
          techProfile: input.techProfile,
          primaryChannel: input.primaryChannel,
          fallbackChannels: input.fallbackChannels,
          scheduleFrequency: input.scheduleFrequency,
          scheduleTimeWindow: input.scheduleTimeWindow,
          scheduleCustomCron: input.scheduleCustomCron,
        }
      : null;
  }

  async pauseForUserById(input: {
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverRecord | null> {
    const record = this.records.find((receiver) => receiver.id === input.receiverId);
    return record
      ? {
          ...record,
          pausedUntil: input.pausedUntil,
          pausedReason: input.pausedReason,
        }
      : null;
  }

  async resumeForUserById(input: { receiverId: string }): Promise<ReceiverRecord | null> {
    const record = this.records.find((receiver) => receiver.id === input.receiverId);
    return record
      ? {
          ...record,
          pausedUntil: undefined,
          pausedReason: undefined,
        }
      : null;
  }

  async deleteForUserById(input: {
    userId: string;
    receiverId: string;
    deletedAt: Date;
  }): Promise<ReceiverRecord | null> {
    const record = this.records.find(
      (receiver) => receiver.id === input.receiverId && receiver.userId === input.userId,
    );
    return record
      ? {
          ...record,
          deletedAt: input.deletedAt,
        }
      : null;
  }

  async markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord> {
    const record = this.records.find((receiver) => receiver.id === input.receiverId);
    if (!record) {
      throw new Error('Receiver not found');
    }
    return {
      ...record,
      consentRequestedAt: input.consentRequestedAt,
      consentTranscript: input.consentTranscript,
    };
  }

  async updateConsentResponse(input: {
    receiverId: string;
    consentStatus: ConsentStatus;
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  }): Promise<ReceiverRecord> {
    this.consentUpdate = input;
    this.consentUpdates.push({ receiverId: input.receiverId, consentStatus: input.consentStatus });
    const record = this.records.find((receiver) => receiver.id === input.receiverId);
    if (!record) {
      throw new Error('Receiver not found');
    }
    return {
      ...record,
      consentStatus: input.consentStatus,
      consentTranscript: input.consentTranscript,
      consentGrantedAt: input.consentGrantedAt,
      consentRevokedAt: input.consentRevokedAt,
    };
  }

  async createAbuseReport(input: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }> {
    this.abuseReport = input;
    return {
      id: 'abuse-report-1',
      receiverId: input.receiverId,
      reviewStatus: AbuseReportStatus.PENDING,
      reportedAt: input.reportedAt,
    };
  }

  async pauseForAbuseReview(input: { receiverId: string; pausedReason: string }): Promise<ReceiverRecord> {
    this.pausedReceiver = input;
    const record = this.records.find((receiver) => receiver.id === input.receiverId);
    if (!record) {
      throw new Error('Receiver not found');
    }
    return {
      ...record,
      pausedReason: input.pausedReason,
    };
  }

  async upsertOptOutCooldown(input: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  }): Promise<void> {
    this.optOutCooldown = input;
    this.optOutCooldowns.push(input.receiverId);
  }

  async resolveCheckInForUserById(): Promise<null> {
    return null;
  }
}

class InMemoryNotificationsService {
  public pushes: SendUserPushInput[] = [];

  constructor(
    private readonly outcome: 'sent' | 'no_tokens' | 'throws' = 'sent',
    private readonly now: () => Date = () => new Date('2026-04-26T11:00:00.000Z'),
  ) {}

  async sendQuietUpdateToUser(input: SendUserPushInput): Promise<SendUserPushResult> {
    if (this.outcome === 'throws') {
      throw new Error('Expo push request failed with 503');
    }
    this.pushes.push(input);
    return this.outcome === 'sent'
      ? { attempted: 1, sent: 1, failed: 0, sentAt: this.now() }
      : { attempted: 0, sent: 0, failed: 0 };
  }
}

class InMemoryBackupContactsRepository implements BackupContactsRepository {
  public records: BackupContactRecord[] = [];

  async findActiveByPhoneHash(phoneHash: string): Promise<BackupContactRecord | null> {
    return this.records.find((contact) => contact.phoneHash === phoneHash && !contact.deletedAt) ?? null;
  }

  async findManyForReceiverForUser(): Promise<BackupContactRecord[] | null> {
    return [];
  }

  async countActiveForReceiverForUser(): Promise<number | null> {
    return 0;
  }

  async createForReceiverForUser(): Promise<BackupContactRecord | null> {
    return null;
  }

  async updateForReceiverForUser(): Promise<BackupContactRecord | null> {
    return null;
  }

  async deleteForReceiverForUser(): Promise<BackupContactRecord | null> {
    return null;
  }
}

class InMemoryCheckInsRepository implements CheckInsRepository {
  public openCheckIn: CheckInRecord | null = null;
  public actionableCheckIn: CheckInRecord | null = null;
  public responseUpdate: {
    checkInId: string;
    status: CheckInStatus;
    respondedAt: Date;
    responseDetectedAs: 'ok' | 'help';
    responseTranscript: string;
  } | null = null;
  public backupResolution: ResolveCheckInByBackupContactInput | null = null;
  public respondedAttempt: { checkInId: string; completedAt: Date } | null = null;
  public skippedAttempts: { checkInId: string; completedAt: Date; failureReason: string } | null = null;

  async findReceiversDueForCheckIn(_now: Date): Promise<{ candidates: CheckInReceiverCandidate[]; skipped: [] }> {
    return { candidates: [], skipped: [] };
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    return {
      id: 'check-in-created',
      receiverId: input.receiverId,
      scheduledAt: input.scheduledAt,
      status: CheckInStatus.PENDING,
      createdAt: input.scheduledAt,
      updatedAt: input.scheduledAt,
    };
  }

  async markSent(_input: MarkCheckInSentInput): Promise<boolean> {
    return true;
  }

  async findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    return this.openCheckIn?.receiverId === receiverId ? this.openCheckIn : null;
  }

  async findOpenForReceiver(receiverId: string): Promise<CheckInRecord[]> {
    return this.openCheckIn?.receiverId === receiverId ? [this.openCheckIn] : [];
  }

  async markCancelled(_input: { checkInId: string }): Promise<boolean> {
    return true;
  }

  async createAttempts(): Promise<[]> {
    return [];
  }

  async findDuePendingAttempts(): Promise<[]> {
    return [];
  }

  async findTimedOutSentAttempts(): Promise<[]> {
    return [];
  }

  async markAttemptSent(_input: {
    attemptId: string;
    sentAt: Date;
    providerMessageId: string;
    providerStatus: string;
  }): Promise<boolean> {
    return true;
  }

  async markAttemptFailed(_input: { attemptId: string; completedAt: Date; failureReason: string }): Promise<boolean> {
    return true;
  }

  async markSentAttemptProviderFailure(): Promise<null> {
    return null;
  }

  async markAttemptTimedOut(_input: { attemptId: string; completedAt: Date }): Promise<boolean> {
    return true;
  }

  async markLatestSentAttemptResponded(input: { checkInId: string; completedAt: Date }) {
    this.respondedAttempt = input;
    return {
      id: 'attempt-1',
      checkInId: input.checkInId,
      attemptNumber: 1,
      channel: Channel.WHATSAPP,
      status: CheckInAttemptStatus.RESPONDED,
      scheduledAt: input.completedAt,
      completedAt: input.completedAt,
      createdAt: input.completedAt,
      updatedAt: input.completedAt,
    };
  }

  async skipPendingAttemptsForCheckIn(input: {
    checkInId: string;
    completedAt: Date;
    failureReason: string;
  }): Promise<number> {
    this.skippedAttempts = input;
    return 1;
  }

  async markNeedsAttention(_input: { checkInId: string }): Promise<boolean> {
    return true;
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

  async findLatestActionableForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    return this.actionableCheckIn?.receiverId === receiverId ? this.actionableCheckIn : null;
  }

  async markResponded(input: {
    checkInId: string;
    status: CheckInStatus;
    respondedAt: Date;
    responseDetectedAs: 'ok' | 'help';
    responseTranscript: string;
  }): Promise<CheckInRecord> {
    this.responseUpdate = input;
    return {
      id: input.checkInId,
      receiverId: this.openCheckIn?.receiverId ?? 'receiver-1',
      scheduledAt: this.openCheckIn?.scheduledAt ?? input.respondedAt,
      status: input.status,
      respondedAt: input.respondedAt,
      responseDetectedAs: input.responseDetectedAs,
      responseTranscript: input.responseTranscript,
      createdAt: this.openCheckIn?.createdAt ?? input.respondedAt,
      updatedAt: input.respondedAt,
    };
  }

  async markResolvedByBackupContact(input: ResolveCheckInByBackupContactInput): Promise<CheckInRecord> {
    this.backupResolution = input;
    return {
      id: input.checkInId,
      receiverId: this.actionableCheckIn?.receiverId ?? 'receiver-1',
      scheduledAt: this.actionableCheckIn?.scheduledAt ?? input.resolvedAt,
      status: CheckInStatus.RESOLVED,
      channelUsed: this.actionableCheckIn?.channelUsed,
      sentAt: this.actionableCheckIn?.sentAt,
      respondedAt: this.actionableCheckIn?.respondedAt,
      responseDetectedAs: this.actionableCheckIn?.responseDetectedAs,
      resolvedAt: input.resolvedAt,
      resolutionNote: this.actionableCheckIn?.resolutionNote,
      createdAt: this.actionableCheckIn?.createdAt ?? input.resolvedAt,
      updatedAt: input.resolvedAt,
    };
  }
}

class InMemoryEscalationsRepository implements EscalationsRepository {
  public backupContacts: EscalationBackupContactRecord[] = [];
  public createdEvents: CreateEscalationEventInput[] = [];
  public escalatedCheckIns: string[] = [];
  public terminalStatuses: { checkInId: string; status: CheckInStatus }[] = [];

  constructor(private readonly owner: { userId: string; phoneEncrypted: string }) {}

  async findReceiverOwner(): Promise<{ userId: string; phoneEncrypted: string } | null> {
    return this.owner;
  }

  async findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]> {
    return this.backupContacts.filter((contact) => contact.receiverId === input.receiverId);
  }

  async createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord> {
    this.createdEvents.push(input);
    return { id: `escalation-event-${this.createdEvents.length}`, ...input };
  }

  async markCheckInEscalated(input: { checkInId: string }): Promise<void> {
    this.escalatedCheckIns.push(input.checkInId);
  }

  async markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void> {
    this.terminalStatuses.push(input);
  }
}

class InMemoryEscalationsService {
  public helpEscalations: { receiverId: string; checkInId: string; sourceChannel: Channel }[] = [];

  async escalateHelpResponse(input: { receiverId: string; checkInId: string; sourceChannel: Channel }) {
    this.helpEscalations.push(input);
    return {
      checkInId: input.checkInId,
      status: CheckInStatus.ESCALATED,
      attempted: 1,
      succeeded: 1,
      failed: 0,
    };
  }
}

describe('ReceiverReplyService', () => {
  it('grants consent when a pending receiver replies YES', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService, audit } = createRealAuditService();
    repository.records.push(receiverFixture(crypto));
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-26T11:00:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: ' yes ',
      providerMessageId: 'provider-message-1',
      providerReceivedAt: new Date('2026-04-26T11:00:00.000Z'),
      ipAddress: '203.0.113.10',
      userAgent: 'TwilioWebhook/1.0',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'consent_granted',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(repository.consentUpdate?.receiverId).toBe('1aef91f9-64c9-4548-baa5-d70b52386efb');
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.GRANTED);
    expect(repository.consentUpdate?.consentGrantedAt).toEqual(new Date('2026-04-26T11:00:00.000Z'));
    const transcript = JSON.parse(crypto.decrypt(repository.consentUpdate?.consentTranscript ?? ''));
    expect(transcript).toEqual({
      receivedAt: '2026-04-26T11:00:00.000Z',
      channel: Channel.WHATSAPP,
      normalizedReply: 'YES',
      providerMessageId: 'provider-message-1',
      providerReceivedAt: '2026-04-26T11:00:00.000Z',
    });
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.consent_granted',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.WHATSAPP,
          normalizedReply: 'YES',
          providerMessageId: 'provider-message-1',
        },
        ipAddress: '203.0.113.10',
        userAgent: 'TwilioWebhook/1.0',
      },
    ]);
  });

  it('declines consent when a pending receiver replies NO', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService, audit } = createRealAuditService();
    repository.records.push(receiverFixture(crypto));
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-26T11:00:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: 'no',
      providerMessageId: 'provider-message-2',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'consent_declined',
      consentStatus: ConsentStatus.DECLINED,
    });
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.DECLINED);
    expect(repository.consentUpdate?.consentGrantedAt).toBeUndefined();
    expect(audit.events[0]).toMatchObject({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.consent_declined',
      actorType: ActorType.SYSTEM,
      metadata: {
        channel: Channel.SMS,
        normalizedReply: 'NO',
        providerMessageId: 'provider-message-2',
      },
    });
  });

  it('revokes consent immediately when a receiver replies STOP', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService, audit } = createRealAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-26T11:00:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'STOP',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'consent_revoked',
      consentStatus: ConsentStatus.REVOKED,
    });
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.REVOKED);
    expect(repository.consentUpdate?.consentRevokedAt).toEqual(new Date('2026-04-26T11:00:00.000Z'));
    expect(audit.events[0]).toMatchObject({
      action: 'receiver.consent_revoked',
      metadata: {
        channel: Channel.WHATSAPP,
        normalizedReply: 'STOP',
      },
    });
    expect(repository.optOutCooldown).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      optOutAt: new Date('2026-04-26T11:00:00.000Z'),
      cooldownUntil: new Date('2026-05-03T11:00:00.000Z'),
      optOutChannel: Channel.WHATSAPP,
      optOutKeyword: 'STOP',
    });
  });

  it('creates an abuse report and pauses the receiver when a receiver replies REPORT', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService, audit } = createRealAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-26T11:00:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: 'REPORT',
      providerMessageId: 'provider-message-3',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'abuse_reported',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(repository.abuseReport).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      reporterPhoneHash: crypto.hashForLookup('+971501234567'),
      reportContent: expect.any(String),
      reportedAt: new Date('2026-04-26T11:00:00.000Z'),
    });
    expect(crypto.decrypt(repository.abuseReport?.reportContent ?? '')).toBe('REPORT');
    expect(repository.pausedReceiver).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedReason: 'abuse_report_pending_review',
    });
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.abuse_reported',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.SMS,
          normalizedReply: 'REPORT',
          providerMessageId: 'provider-message-3',
          reviewStatus: AbuseReportStatus.PENDING,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
  });

  it('marks the latest open check-in responded OK when a granted receiver replies OK', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    checkIns.openCheckIn = checkInFixture(CheckInStatus.SENT);
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-27T05:45:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: " I'm fine ",
      providerMessageId: 'provider-message-4',
      providerReceivedAt: new Date('2026-04-27T05:45:00.000Z'),
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'check_in_responded_ok',
      consentStatus: ConsentStatus.GRANTED,
      checkInId: 'check-in-1',
      checkInStatus: CheckInStatus.RESPONDED_OK,
    });
    expect(repository.consentUpdate).toBeNull();
    expect(checkIns.responseUpdate?.checkInId).toBe('check-in-1');
    expect(checkIns.responseUpdate?.status).toBe(CheckInStatus.RESPONDED_OK);
    expect(checkIns.responseUpdate?.respondedAt).toEqual(new Date('2026-04-27T05:45:00.000Z'));
    expect(checkIns.responseUpdate?.responseDetectedAs).toBe('ok');
    const transcript = JSON.parse(crypto.decrypt(checkIns.responseUpdate?.responseTranscript ?? ''));
    expect(transcript).toEqual({
      receivedAt: '2026-04-27T05:45:00.000Z',
      channel: Channel.WHATSAPP,
      normalizedReply: 'OK',
      providerMessageId: 'provider-message-4',
      providerReceivedAt: '2026-04-27T05:45:00.000Z',
    });
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.responded_ok',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          channel: Channel.WHATSAPP,
          responseDetectedAs: 'ok',
          providerMessageId: 'provider-message-4',
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
  });

  it('marks the latest open check-in responded HELP when a granted receiver replies HELP', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    const escalations = new InMemoryEscalationsService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    checkIns.openCheckIn = checkInFixture(CheckInStatus.SENT);
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      auditService,
      escalations,
      undefined,
      () => new Date('2026-04-27T05:45:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: '2',
      providerMessageId: 'provider-message-5',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'check_in_responded_help',
      consentStatus: ConsentStatus.GRANTED,
      checkInId: 'check-in-1',
      checkInStatus: CheckInStatus.RESPONDED_HELP,
    });
    expect(checkIns.responseUpdate?.status).toBe(CheckInStatus.RESPONDED_HELP);
    expect(checkIns.responseUpdate?.responseDetectedAs).toBe('help');
    expect(audit.events[0]).toMatchObject({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.responded_help',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        channel: Channel.SMS,
        responseDetectedAs: 'help',
        providerMessageId: 'provider-message-5',
      },
    });
    expect(escalations.helpEscalations).toEqual([
      {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
        sourceChannel: Channel.SMS,
      },
    ]);
  });

  it('marks the latest actionable check-in resolved when an active backup contact replies DONE', async () => {
    const crypto = new CryptoService(masterKey);
    const receivers = new InMemoryReceiversRepository();
    const backupContacts = new InMemoryBackupContactsRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    backupContacts.records.push(backupContactFixture(crypto));
    checkIns.actionableCheckIn = {
      ...checkInFixture(CheckInStatus.ESCALATED),
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseDetectedAs: 'help',
    };
    const service = new ReceiverReplyService(
      receivers,
      checkIns,
      crypto,
      auditService,
      undefined,
      backupContacts,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.WHATSAPP,
      body: ' done ',
      providerMessageId: 'backup-message-1',
      providerReceivedAt: new Date('2026-04-27T06:30:00.000Z'),
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: 'backup-contact-1',
      action: 'check_in_resolved_by_backup',
      checkInId: 'check-in-1',
      checkInStatus: CheckInStatus.RESOLVED,
    });
    expect(checkIns.backupResolution).toEqual({
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
    });
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.resolved_by_backup',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          backupContactId: 'backup-contact-1',
          channel: Channel.WHATSAPP,
          normalizedReply: 'DONE',
          providerMessageId: 'backup-message-1',
          resolutionTextStored: true,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('phone');
    expect(JSON.stringify(audit.events)).not.toContain('name');
    expect(JSON.stringify(audit.events)).not.toContain('message body');
  });

  it('runs HELP -> backup contact alert -> backup DONE through the real EscalationsService and audit guard', async () => {
    const now = () => new Date('2026-04-27T05:45:00.000Z');
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const backupContacts = new InMemoryBackupContactsRepository();
    const escalationsRepository = new InMemoryEscalationsRepository({
      userId: 'sender-1',
      phoneEncrypted: crypto.encrypt('+971508888888'),
    });
    const { auditService, audit } = createRealAuditService(now);
    const sms = new FakeChannelProvider(Channel.SMS, { now });
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, { now });
    const backupContact = backupContactFixture(crypto);
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    backupContacts.records.push(backupContact);
    escalationsRepository.backupContacts.push({
      id: backupContact.id,
      receiverId: backupContact.receiverId,
      nameEncrypted: backupContact.nameEncrypted,
      phoneEncrypted: backupContact.phoneEncrypted,
      priorityOrder: backupContact.priorityOrder,
      createdAt: backupContact.createdAt,
    });
    checkIns.openCheckIn = checkInFixture(CheckInStatus.SENT);
    const escalations = new EscalationsService(
      escalationsRepository,
      crypto,
      new ChannelRouterService([sms, whatsapp]),
      auditService,
      now,
    );
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      auditService,
      escalations,
      backupContacts,
      now,
    );

    const helpResult = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: 'HELP',
      providerMessageId: 'provider-message-help',
    });

    expect(helpResult).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'check_in_responded_help',
      consentStatus: ConsentStatus.GRANTED,
      checkInId: 'check-in-1',
      checkInStatus: CheckInStatus.RESPONDED_HELP,
    });
    expect(escalationsRepository.escalatedCheckIns).toEqual(['check-in-1']);
    // One alert per backup contact (CB-011): the fake WhatsApp provider claims the number, so WhatsApp wins.
    expect(whatsapp.sentMessages.map((sent) => sent.to)).toEqual(['+971509999999']);
    expect(sms.sentMessages).toEqual([]);
    expect(
      escalationsRepository.createdEvents.map((event) => ({
        attemptNumber: event.attemptNumber,
        channel: event.channel,
        result: event.result,
      })),
    ).toEqual([{ attemptNumber: 1, channel: Channel.WHATSAPP, result: EscalationResult.SUCCESS }]);
    expect(audit.events.map((event) => event.action)).toEqual([
      'check_in.responded_help',
      'escalation.backup_contact_alerted',
      'check_in.escalated',
    ]);
    expect(audit.events[1]).toMatchObject({
      entityType: 'escalation_event',
      entityId: 'escalation-event-1',
      action: 'escalation.backup_contact_alerted',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
        backupContactId: 'backup-contact-1',
        channel: Channel.WHATSAPP,
        attemptNumber: 1,
      },
    });

    // The backup contact now replies DONE from their own number.
    checkIns.actionableCheckIn = {
      ...checkInFixture(CheckInStatus.ESCALATED),
      respondedAt: now(),
      responseDetectedAs: 'help',
    };
    const doneResult = await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.SMS,
      body: 'DONE',
      providerMessageId: 'provider-message-done',
    });

    expect(doneResult).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: 'backup-contact-1',
      action: 'check_in_resolved_by_backup',
      checkInId: 'check-in-1',
      checkInStatus: CheckInStatus.RESOLVED,
    });
    expect(checkIns.backupResolution).toEqual({ checkInId: 'check-in-1', resolvedAt: now() });
    expect(audit.events.at(-1)).toMatchObject({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.resolved_by_backup',
      metadata: { backupContactId: 'backup-contact-1', normalizedReply: 'DONE' },
    });
    expect(JSON.stringify(audit.events)).not.toContain('+971509999999');
    expect(JSON.stringify(audit.events)).not.toContain('+971501234567');
    expect(JSON.stringify(audit.events)).not.toContain('Backup Contact');
  });

  it('ignores unsupported backup contact replies without resolving check-ins', async () => {
    const crypto = new CryptoService(masterKey);
    const receivers = new InMemoryReceiversRepository();
    const backupContacts = new InMemoryBackupContactsRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService();
    backupContacts.records.push(backupContactFixture(crypto));
    checkIns.actionableCheckIn = checkInFixture(CheckInStatus.ESCALATED);
    const service = new ReceiverReplyService(
      receivers,
      checkIns,
      crypto,
      auditService,
      undefined,
      backupContacts,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.SMS,
      body: 'hello',
    });

    expect(result).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      backupContactId: 'backup-contact-1',
      action: 'unrecognised_reply',
    });
    expect(checkIns.backupResolution).toBeNull();
    expect(audit.events).toEqual([
      {
        entityType: 'backup_contact',
        entityId: 'backup-contact-1',
        action: 'backup_contact.reply_unrecognised',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          channel: Channel.SMS,
          normalizedReply: 'UNKNOWN',
          providerMessageId: undefined,
          bodyLength: 5,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('hello');
  });
});

function receiverFixture(crypto: CryptoService): ReceiverRecord {
  return {
    id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    nameEncrypted: crypto.encrypt('Fatima Parent'),
    phoneEncrypted: crypto.encrypt('+971501234567'),
    phoneHash: crypto.hashForLookup('+971501234567'),
    countryCode: 'AE',
    relationshipType: RelationshipType.PARENT,
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
    consentStatus: ConsentStatus.PENDING,
    consentRequestedAt: new Date('2026-04-26T10:00:00.000Z'),
    createdAt: new Date('2026-04-26T10:00:00.000Z'),
    updatedAt: new Date('2026-04-26T10:00:00.000Z'),
  };
}

function checkInFixture(status: CheckInStatus): CheckInRecord {
  return {
    id: 'check-in-1',
    receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
    status,
    channelUsed: Channel.WHATSAPP,
    sentAt: new Date('2026-04-27T05:30:00.000Z'),
    createdAt: new Date('2026-04-27T05:30:00.000Z'),
    updatedAt: new Date('2026-04-27T05:30:00.000Z'),
  };
}

function backupContactFixture(crypto: CryptoService): BackupContactRecord {
  return {
    id: 'backup-contact-1',
    receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    nameEncrypted: crypto.encrypt('Backup Contact'),
    phoneEncrypted: crypto.encrypt('+971509999999'),
    phoneHash: crypto.hashForLookup('+971509999999'),
    relationshipToReceiver: 'Cousin',
    priorityOrder: 0,
    createdAt: new Date('2026-04-26T10:00:00.000Z'),
  };
}

describe('ReceiverReplyService abuse-review pause (CB-007)', () => {
  it('pauses a reported receiver with the reason the admin safe review lifts', async () => {
    // Imported here so this block stays append-only while the setup above is reworked in parallel.
    const { ABUSE_REVIEW_PAUSE_REASON } = await import('./abuse-review-pause');
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService } = createRealAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      () => new Date('2026-04-26T11:00:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: ' report ',
      providerMessageId: 'SM-report-1',
    });

    expect(result.action).toBe('abuse_reported');
    expect(repository.pausedReceiver).toEqual({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedReason: ABUSE_REVIEW_PAUSE_REASON,
    });
    expect(repository.pausedReceiver?.pausedReason).toBe('abuse_report_pending_review');
  });
});

describe('ReceiverReplyService never fails inbound replies (CB-015)', () => {
  const receiverId = '1aef91f9-64c9-4548-baa5-d70b52386efb';
  const unattributedEntityId = '00000000-0000-0000-0000-000000000000';

  // The real AuditService rejects metadata keys that look like PII (anything containing "contact", "phone", ...).
  // Every row written here must pass that check or the webhook 500s again.
  function realAuditService() {
    const { auditService, audit } = createRealAuditService(() => new Date('2026-04-27T06:30:00.000Z'));
    return { service: auditService, events: audit.events };
  }

  it('audits free text from a known receiver as unrecognised instead of throwing', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const audit = realAuditService();
    repository.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      audit.service,
      undefined,
      undefined,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: "Thanks, I'm fine",
      providerMessageId: 'SM-free-text',
    });

    expect(result).toEqual({
      receiverId,
      action: 'unrecognised_reply',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(repository.consentUpdate).toBeNull();
    expect(checkIns.responseUpdate).toBeNull();
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: receiverId,
        action: 'receiver.reply_unrecognised',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.SMS,
          normalizedReply: 'UNKNOWN',
          providerMessageId: 'SM-free-text',
          bodyLength: 16,
          consentStatus: ConsentStatus.GRANTED,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('fine');
    expect(JSON.stringify(audit.events)).not.toContain('971501234567');
  });

  it('audits a YES with no open check-in as ignored instead of throwing', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const audit = realAuditService();
    repository.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      audit.service,
      undefined,
      undefined,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
      providerMessageId: 'SM-late-yes',
    });

    expect(result).toEqual({
      receiverId,
      action: 'no_open_check_in',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(repository.consentUpdate).toBeNull();
    expect(checkIns.responseUpdate).toBeNull();
    expect(audit.events).toEqual([
      expect.objectContaining({
        entityType: 'receiver',
        entityId: receiverId,
        action: 'receiver.check_in_reply_ignored',
        metadata: {
          channel: Channel.WHATSAPP,
          normalizedReply: 'YES',
          providerMessageId: 'SM-late-yes',
          reason: 'no_open_check_in',
        },
      }),
    ]);
  });

  it('audits an unknown sender with a hash prefix only', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const backupContacts = new InMemoryBackupContactsRepository();
    const audit = realAuditService();
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit.service,
      undefined,
      backupContacts,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971508888888',
      channel: Channel.SMS,
      body: 'OK',
      providerMessageId: 'SM-stranger',
      ipAddress: '203.0.113.30',
      userAgent: 'TwilioProxy/1.1',
    });

    expect(result).toEqual({ receiverId: '', action: 'unknown_sender' });
    expect(audit.events).toEqual([
      {
        entityType: 'inbound_reply',
        entityId: unattributedEntityId,
        action: 'inbound_reply.unknown_sender',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.SMS,
          providerMessageId: 'SM-stranger',
          senderHashPrefix: crypto.hashForLookup('+971508888888').slice(0, 12),
          bodyLength: 2,
        },
        ipAddress: '203.0.113.30',
        userAgent: 'TwilioProxy/1.1',
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('971508888888');
    expect(JSON.stringify(audit.events)).not.toContain(crypto.hashForLookup('+971508888888'));
  });

  it('audits a short-code sender as invalid instead of throwing from phone normalisation', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = realAuditService();
    repository.records.push(receiverFixture(crypto));
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit.service,
      undefined,
      undefined,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+12345',
      channel: Channel.SMS,
      body: 'Your verification code is 000000',
      providerMessageId: 'SM-short-code',
    });

    expect(result).toEqual({ receiverId: '', action: 'invalid_sender' });
    expect(repository.consentUpdate).toBeNull();
    expect(audit.events).toEqual([
      {
        entityType: 'inbound_reply',
        entityId: unattributedEntityId,
        action: 'inbound_reply.invalid_sender',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.SMS,
          providerMessageId: 'SM-short-code',
          bodyLength: 32,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('12345');
    expect(JSON.stringify(audit.events)).not.toContain('verification');
  });

  it('audits a backup contact DONE with nothing to resolve as ignored instead of throwing', async () => {
    const crypto = new CryptoService(masterKey);
    const backupContacts = new InMemoryBackupContactsRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const audit = realAuditService();
    backupContacts.records.push(backupContactFixture(crypto));
    const service = new ReceiverReplyService(
      new InMemoryReceiversRepository(),
      checkIns,
      crypto,
      audit.service,
      undefined,
      backupContacts,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.SMS,
      body: 'DONE',
      providerMessageId: 'SM-late-done',
    });

    expect(result).toEqual({
      receiverId,
      backupContactId: 'backup-contact-1',
      action: 'no_actionable_check_in',
    });
    expect(checkIns.backupResolution).toBeNull();
    expect(audit.events).toEqual([
      expect.objectContaining({
        entityType: 'backup_contact',
        entityId: 'backup-contact-1',
        action: 'backup_contact.reply_ignored',
        metadata: {
          receiverId,
          channel: Channel.SMS,
          normalizedReply: 'DONE',
          providerMessageId: 'SM-late-done',
          reason: 'no_actionable_check_in',
        },
      }),
    ]);
  });

  it('passes the real audit PII check for unrecognised backup contact text', async () => {
    const crypto = new CryptoService(masterKey);
    const backupContacts = new InMemoryBackupContactsRepository();
    const audit = realAuditService();
    backupContacts.records.push(backupContactFixture(crypto));
    const service = new ReceiverReplyService(
      new InMemoryReceiversRepository(),
      new InMemoryCheckInsRepository(),
      crypto,
      audit.service,
      undefined,
      backupContacts,
      () => new Date('2026-04-27T06:30:00.000Z'),
    );

    const result = await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.WHATSAPP,
      body: 'On my way',
    });

    expect(result.action).toBe('unrecognised_reply');
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe('backup_contact.reply_unrecognised');
  });
});

describe('ReceiverReplyService cancels in-flight check-ins on STOP and REPORT (CB-008)', () => {
  class InMemoryCheckInsService {
    public cancelled: Array<{ receiverId: string; reason: string }> = [];

    async cancelOpenCheckInsForReceiver(input: { receiverId: string; reason: string }) {
      this.cancelled.push(input);
      return { cancelled: 1, skippedAttempts: 1 };
    }
  }

  function serviceWith(
    checkInsService: InMemoryCheckInsService,
    crypto: CryptoService,
    repository: InMemoryReceiversRepository,
  ) {
    return new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      createRealAuditService().auditService,
      undefined,
      undefined,
      () => new Date('2026-04-27T05:40:00.000Z'),
      checkInsService as unknown as CheckInsService,
    );
  }

  it('cancels open check-ins after a STOP so the next cascade attempt never goes out', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkInsService = new InMemoryCheckInsService();
    repository.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });

    const result = await serviceWith(checkInsService, crypto, repository).handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: 'STOP',
    });

    expect(result.action).toBe('consent_revoked');
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.REVOKED);
    expect(checkInsService.cancelled).toEqual([
      { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', reason: 'receiver_opted_out' },
    ]);
  });

  it('cancels open check-ins after a REPORT alongside the review pause', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkInsService = new InMemoryCheckInsService();
    repository.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });

    const result = await serviceWith(checkInsService, crypto, repository).handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'REPORT',
    });

    expect(result.action).toBe('abuse_reported');
    expect(repository.pausedReceiver?.receiverId).toBe('1aef91f9-64c9-4548-baa5-d70b52386efb');
    expect(checkInsService.cancelled).toEqual([
      { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', reason: 'abuse_reported' },
    ]);
  });

  it('does not cancel anything for a YES, which closes the check-in through the reply itself', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkInsService = new InMemoryCheckInsService();
    repository.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });

    await serviceWith(checkInsService, crypto, repository).handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
    });

    expect(checkInsService.cancelled).toEqual([]);
  });
});

const RECEIVER_ID = '1aef91f9-64c9-4548-baa5-d70b52386efb';
const SENDER_ID = '61a5639c-c902-4950-9924-1a4d6db1e02d';
const RECEIVER_DEEP_LINK = `/(main)/receivers/${RECEIVER_ID}`;

describe('ReceiverReplyService tells the sender quietly and confirms a STOP to the receiver (CB-012)', () => {
  const now = () => new Date('2026-04-26T11:00:00.000Z');

  function harness(options: {
    receiver: ReceiverRecord;
    notifications?: InMemoryNotificationsService;
    providers?: FakeChannelProvider[];
    checkIns?: InMemoryCheckInsRepository;
    backupContacts?: InMemoryBackupContactsRepository;
  }) {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const { auditService, audit } = createRealAuditService(now);
    const notifications = options.notifications ?? new InMemoryNotificationsService('sent', now);
    repository.records.push(options.receiver);
    const service = new ReceiverReplyService(
      repository,
      options.checkIns ?? new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      options.backupContacts,
      now,
      undefined,
      notifications,
      options.providers ? new ChannelRouterService(options.providers) : undefined,
    );

    return { crypto, repository, audit, notifications, service };
  }

  it('pushes a quiet "consent received" update to the sender when the receiver replies YES', async () => {
    const crypto = new CryptoService(masterKey);
    const { audit, notifications, service } = harness({ receiver: receiverFixture(crypto) });

    await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.WHATSAPP, body: 'YES' });

    expect(notifications.pushes).toEqual([
      {
        userId: SENDER_ID,
        title: 'Consent received',
        body: expect.any(String),
        data: { receiverId: RECEIVER_ID, reason: 'consent_granted', deepLink: RECEIVER_DEEP_LINK },
      },
    ]);
    expect(audit.events.map((event) => event.action)).toEqual(['receiver.consent_granted', 'sender_push.sent']);
    expect(audit.events[1]).toMatchObject({
      entityType: 'receiver',
      entityId: RECEIVER_ID,
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: RECEIVER_ID,
        attempted: 1,
        sent: 1,
        failed: 0,
        reason: 'consent_granted',
        deepLink: RECEIVER_DEEP_LINK,
      },
    });
    expect(JSON.stringify(notifications.pushes)).not.toContain('Fatima');
    expect(JSON.stringify(notifications.pushes)).not.toContain('+971501234567');
  });

  it('pushes a quiet "consent declined" update when the receiver replies NO', async () => {
    const crypto = new CryptoService(masterKey);
    const { notifications, service } = harness({ receiver: receiverFixture(crypto) });

    await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'NO' });

    expect(notifications.pushes).toEqual([
      expect.objectContaining({
        userId: SENDER_ID,
        title: 'Consent declined',
        data: { receiverId: RECEIVER_ID, reason: 'consent_declined', deepLink: RECEIVER_DEEP_LINK },
      }),
    ]);
  });

  it('confirms a STOP to the receiver on the channel it arrived on and pushes the sender quietly', async () => {
    const crypto = new CryptoService(masterKey);
    const sms = new FakeChannelProvider(Channel.SMS, { now });
    const { audit, notifications, service } = harness({
      receiver: { ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED },
      providers: [sms],
    });

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.SMS,
      body: 'STOP',
      providerMessageId: 'provider-message-stop',
    });

    expect(result).toEqual({
      receiverId: RECEIVER_ID,
      action: 'consent_revoked',
      consentStatus: ConsentStatus.REVOKED,
    });
    expect(sms.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'receiver_checkins_ended',
          language: 'en',
          variables: { receiverName: 'Fatima Parent', senderDisplayName: 'your family member' },
        },
      },
    ]);
    expect(sms.renderedMessages[0]?.body).toContain('ended your Nearby check-ins');
    expect(notifications.pushes).toEqual([
      expect.objectContaining({
        userId: SENDER_ID,
        title: 'Check-ins stopped',
        data: { receiverId: RECEIVER_ID, reason: 'receiver_opted_out', deepLink: RECEIVER_DEEP_LINK },
      }),
    ]);
    expect(audit.events.map((event) => event.action)).toEqual([
      'receiver.consent_revoked',
      'receiver.opt_out_confirmation_sent',
      'sender_push.sent',
    ]);
    expect(audit.events[1]).toMatchObject({
      entityType: 'receiver',
      entityId: RECEIVER_ID,
      metadata: {
        channel: Channel.SMS,
        templateKey: 'receiver_checkins_ended',
        providerStatus: 'accepted',
        renderedLanguage: 'en',
        renderFallback: false,
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain('Fatima');
  });

  it('keeps the STOP effective and audits when the confirmation cannot be sent', async () => {
    const crypto = new CryptoService(masterKey);
    // Only WhatsApp is wired; the STOP arrives by SMS, so the router has no provider for the confirmation.
    const { audit, repository, service } = harness({
      receiver: { ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED },
      providers: [new FakeChannelProvider(Channel.WHATSAPP, { now })],
    });

    const result = await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'STOP' });

    expect(result.action).toBe('consent_revoked');
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.REVOKED);
    expect(repository.optOutCooldown?.receiverId).toBe(RECEIVER_ID);
    expect(audit.events[1]).toMatchObject({
      action: 'receiver.opt_out_confirmation_failed',
      metadata: { channel: Channel.SMS, templateKey: 'receiver_checkins_ended', error: expect.any(String) },
    });
  });

  it('audits an undelivered push when the sender has no device and never fails the reply', async () => {
    const crypto = new CryptoService(masterKey);
    const { audit, service } = harness({
      receiver: receiverFixture(crypto),
      notifications: new InMemoryNotificationsService('no_tokens', now),
    });

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
    });

    expect(result.action).toBe('consent_granted');
    expect(audit.events[1]).toMatchObject({
      action: 'sender_push.not_delivered',
      metadata: { attempted: 0, sent: 0, reason: 'consent_granted' },
    });
  });

  it('audits a failed push when the gateway throws and still answers the reply', async () => {
    const crypto = new CryptoService(masterKey);
    const { audit, service } = harness({
      receiver: receiverFixture(crypto),
      notifications: new InMemoryNotificationsService('throws', now),
    });

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
    });

    expect(result.action).toBe('consent_granted');
    expect(audit.events[1]).toMatchObject({
      action: 'sender_push.failed',
      metadata: { reason: 'consent_granted', error: 'Expo push request failed with 503' },
    });
  });

  it('pushes a quiet "backup contact reached them" update to the receiver’s sender on DONE', async () => {
    const crypto = new CryptoService(masterKey);
    const backupContacts = new InMemoryBackupContactsRepository();
    const checkIns = new InMemoryCheckInsRepository();
    backupContacts.records.push(backupContactFixture(crypto));
    checkIns.actionableCheckIn = { ...checkInFixture(CheckInStatus.ESCALATED), responseDetectedAs: 'help' };
    const { audit, notifications, service } = harness({
      receiver: { ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED },
      backupContacts,
      checkIns,
    });

    const result = await service.handleInboundReply({ fromPhone: '+971509999999', channel: Channel.SMS, body: 'DONE' });

    expect(result.action).toBe('check_in_resolved_by_backup');
    expect(notifications.pushes).toEqual([
      expect.objectContaining({
        userId: SENDER_ID,
        title: 'Backup contact reached them',
        data: {
          receiverId: RECEIVER_ID,
          checkInId: 'check-in-1',
          reason: 'backup_contact_done',
          deepLink: RECEIVER_DEEP_LINK,
        },
      }),
    ]);
    expect(audit.events.at(-1)).toMatchObject({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'sender_push.sent',
      metadata: { receiverId: RECEIVER_ID, reason: 'backup_contact_done', sent: 1 },
    });
  });
});

describe('ReceiverReplyService ignores a YES inside the STOP cooldown (CB-009)', () => {
  const now = () => new Date('2026-04-26T11:00:00.000Z');

  function harness(cooldownUntil: Date) {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const notifications = new InMemoryNotificationsService('sent', now);
    const { auditService, audit } = createRealAuditService(now);
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.REVOKED,
      consentRevokedAt: new Date('2026-04-26T10:59:00.000Z'),
    });
    repository.activeCooldown = {
      receiverId: RECEIVER_ID,
      optOutAt: new Date('2026-04-26T10:59:00.000Z'),
      cooldownUntil,
    };
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      auditService,
      undefined,
      undefined,
      now,
      undefined,
      notifications,
    );

    return { repository, audit, notifications, service };
  }

  it('does not re-grant consent one minute after a STOP and audits the ignored YES', async () => {
    const { repository, audit, notifications, service } = harness(new Date('2026-05-03T10:59:00.000Z'));

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
      providerMessageId: 'provider-message-late-yes',
    });

    expect(result).toEqual({
      receiverId: RECEIVER_ID,
      action: 'consent_ignored_cooldown',
      consentStatus: ConsentStatus.REVOKED,
    });
    expect(repository.consentUpdate).toBeNull();
    expect(notifications.pushes).toEqual([]);
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: RECEIVER_ID,
        action: 'receiver.consent_ignored_cooldown',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: Channel.WHATSAPP,
          normalizedReply: 'YES',
          providerMessageId: 'provider-message-late-yes',
          cooldownUntil: '2026-05-03T10:59:00.000Z',
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
  });

  it('grants consent again once the cooldown has lapsed', async () => {
    const { repository, service } = harness(new Date('2026-04-26T10:59:59.000Z'));

    const result = await service.handleInboundReply({
      fromPhone: '+971501234567',
      channel: Channel.WHATSAPP,
      body: 'YES',
    });

    expect(result.action).toBe('consent_granted');
    expect(repository.consentUpdate?.consentStatus).toBe(ConsentStatus.GRANTED);
  });

  it('still lets a NO or STOP through during the cooldown', async () => {
    const { repository, service } = harness(new Date('2026-05-03T10:59:00.000Z'));

    const result = await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'STOP' });

    expect(result.action).toBe('consent_revoked');
    expect(repository.optOutCooldown?.cooldownUntil).toEqual(new Date('2026-05-03T11:00:00.000Z'));
  });
});

describe('ReceiverReplyService resolves a phone shared by two receiver rows (CB-014)', () => {
  const now = () => new Date('2026-04-27T05:45:00.000Z');
  const SECOND_RECEIVER_ID = '2bef91f9-64c9-4548-baa5-d70b52386efc';

  class InMemoryCheckInsService {
    public cancelled: Array<{ receiverId: string; reason: string }> = [];

    async cancelOpenCheckInsForReceiver(input: { receiverId: string; reason: string }) {
      this.cancelled.push(input);
      return { cancelled: 1, skippedAttempts: 1 };
    }
  }

  function harness(rows: ReceiverRecord[], replyTarget: ReceiverRecord, checkIns = new InMemoryCheckInsRepository()) {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const notifications = new InMemoryNotificationsService('sent', now);
    const checkInsService = new InMemoryCheckInsService();
    const sms = new FakeChannelProvider(Channel.SMS, { now });
    const { auditService, audit } = createRealAuditService(now);
    repository.records.push(...rows);
    repository.replyTarget = replyTarget;
    const service = new ReceiverReplyService(
      repository,
      checkIns,
      crypto,
      auditService,
      undefined,
      undefined,
      now,
      checkInsService as unknown as CheckInsService,
      notifications,
      new ChannelRouterService([sms]),
    );

    return { repository, audit, notifications, checkInsService, sms, service };
  }

  it('answers the open check-in of the row the repository resolved and leaves the other row’s consent alone', async () => {
    const crypto = new CryptoService(masterKey);
    const granted = { ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED };
    const pending = { ...receiverFixture(crypto), id: SECOND_RECEIVER_ID, userId: 'sender-b' };
    const checkIns = new InMemoryCheckInsRepository();
    checkIns.openCheckIn = checkInFixture(CheckInStatus.SENT);
    const { repository, service } = harness([pending, granted], granted, checkIns);

    const result = await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'YES' });

    expect(result).toMatchObject({ receiverId: RECEIVER_ID, action: 'check_in_responded_ok', checkInId: 'check-in-1' });
    expect(repository.consentUpdates).toEqual([]);
  });

  it('fans a YES out to every row sharing the phone and tells each sender', async () => {
    const crypto = new CryptoService(masterKey);
    const first = receiverFixture(crypto);
    const second = { ...receiverFixture(crypto), id: SECOND_RECEIVER_ID, userId: 'sender-b' };
    const { repository, audit, notifications, service } = harness([first, second], second);

    const result = await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'YES' });

    expect(result).toEqual({
      receiverId: SECOND_RECEIVER_ID,
      action: 'consent_granted',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(repository.consentUpdates).toEqual([
      { receiverId: SECOND_RECEIVER_ID, consentStatus: ConsentStatus.GRANTED },
      { receiverId: RECEIVER_ID, consentStatus: ConsentStatus.GRANTED },
    ]);
    expect(
      audit.events.filter((event) => event.action === 'receiver.consent_granted').map((event) => event.entityId),
    ).toEqual([SECOND_RECEIVER_ID, RECEIVER_ID]);
    expect(notifications.pushes.map((push) => push.userId).sort()).toEqual([SENDER_ID, 'sender-b']);
    expect(notifications.pushes.find((push) => push.userId === 'sender-b')?.data.receiverId).toBe(SECOND_RECEIVER_ID);
  });

  it('fans a STOP out to every row, cancels each cascade, and confirms to the phone once', async () => {
    const crypto = new CryptoService(masterKey);
    const first = { ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED };
    const second = { ...receiverFixture(crypto), id: SECOND_RECEIVER_ID, consentStatus: ConsentStatus.GRANTED };
    const { repository, checkInsService, sms, notifications, service } = harness([first, second], first);

    const result = await service.handleInboundReply({ fromPhone: '+971501234567', channel: Channel.SMS, body: 'STOP' });

    expect(result.action).toBe('consent_revoked');
    expect(repository.consentUpdates.map((update) => update.receiverId)).toEqual([RECEIVER_ID, SECOND_RECEIVER_ID]);
    expect(repository.optOutCooldowns).toEqual([RECEIVER_ID, SECOND_RECEIVER_ID]);
    expect(checkInsService.cancelled).toEqual([
      { receiverId: RECEIVER_ID, reason: 'receiver_opted_out' },
      { receiverId: SECOND_RECEIVER_ID, reason: 'receiver_opted_out' },
    ]);
    expect(sms.sentMessages).toHaveLength(1);
    // Both rows belong to the same sender, who is told once.
    expect(notifications.pushes).toHaveLength(1);
  });
});

describe('ReceiverReplyService stores the backup contact’s DONE text on the check-in (CB-018)', () => {
  const now = () => new Date('2026-04-27T06:30:00.000Z');

  function harness(existingNote?: string) {
    const crypto = new CryptoService(masterKey);
    const receivers = new InMemoryReceiversRepository();
    const backupContacts = new InMemoryBackupContactsRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const { auditService, audit } = createRealAuditService(now);
    receivers.records.push({ ...receiverFixture(crypto), consentStatus: ConsentStatus.GRANTED });
    backupContacts.records.push(backupContactFixture(crypto));
    checkIns.actionableCheckIn = {
      ...checkInFixture(CheckInStatus.ESCALATED),
      resolutionNote: existingNote ? crypto.encrypt(existingNote) : undefined,
    };
    const service = new ReceiverReplyService(receivers, checkIns, crypto, auditService, undefined, backupContacts, now);

    return { crypto, receivers, audit, service };
  }

  it('encrypts the reply text, as typed, into an empty resolution note', async () => {
    const { crypto, receivers, audit, service } = harness();

    // Only the DONE / CHECKED / RESOLVED keywords close a check-in; the note keeps the contact's own wording.
    await service.handleInboundReply({
      fromPhone: '+971509999999',
      channel: Channel.SMS,
      body: '  Checked  ',
    });

    expect(receivers.resolutionNotes).toHaveLength(1);
    expect(receivers.resolutionNotes[0]?.checkInId).toBe('check-in-1');
    expect(crypto.decrypt(receivers.resolutionNotes[0]?.resolutionNote ?? '')).toBe('Backup contact reply: Checked');
    expect(JSON.stringify(receivers.resolutionNotes)).not.toContain('Checked');
    expect(JSON.stringify(audit.events)).not.toContain('Checked');
    expect(audit.events.at(-1)).toMatchObject({
      action: 'check_in.resolved_by_backup',
      metadata: { resolutionTextStored: true },
    });
  });

  it('appends the reply text after an existing note', async () => {
    const { crypto, receivers, service } = harness('Sender called the neighbour.');

    await service.handleInboundReply({ fromPhone: '+971509999999', channel: Channel.WHATSAPP, body: 'DONE' });

    expect(crypto.decrypt(receivers.resolutionNotes[0]?.resolutionNote ?? '')).toBe(
      'Sender called the neighbour.\nBackup contact reply: DONE',
    );
  });
});
