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
import { CryptoService } from '../../shared/crypto/crypto.service';
import { createRealAuditService } from '../../shared/testing/real-audit';
import type {
  CreateReceiverRecordInput,
  ReceiverRecord,
  ReceiversRepository,
  UpdateReceiverRecordInput,
} from './receivers.repository';
import { ReceiverReplyService } from './receiver-reply.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public records: ReceiverRecord[] = [];
  public consentUpdate: {
    receiverId: string;
    consentStatus: ConsentStatus;
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  } | null = null;
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
    return this.records.find((receiver) => receiver.phoneHash === phoneHash) ?? null;
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
  }

  async resolveCheckInForUserById(): Promise<null> {
    return null;
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
