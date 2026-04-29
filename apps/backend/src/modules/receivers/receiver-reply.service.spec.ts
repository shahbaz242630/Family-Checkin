import {
  AbuseReportStatus,
  ActorType,
  Channel,
  CheckInStatus,
  ConsentStatus,
  RelationshipType,
  TechProfile,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import type {
  CheckInRecord,
  CheckInsRepository,
  CheckInReceiverCandidate,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
} from '../check-ins/check-ins.repository';
import { CryptoService } from '../../shared/crypto/crypto.service';
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
  public consentUpdate:
    | {
        receiverId: string;
        consentStatus: ConsentStatus;
        consentTranscript: string;
        consentGrantedAt?: Date;
        consentRevokedAt?: Date;
      }
    | null = null;
  public abuseReport:
    | {
        receiverId: string;
        reporterPhoneHash: string;
        reportContent?: string;
        reportedAt: Date;
      }
    | null = null;
  public pausedReceiver: { receiverId: string; pausedReason: string } | null = null;
  public optOutCooldown:
    | {
        receiverId: string;
        optOutAt: Date;
        cooldownUntil: Date;
        optOutChannel: Channel;
        optOutKeyword?: string;
      }
    | null = null;

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
    const record = this.records.find((receiver) => receiver.id === input.receiverId && receiver.userId === input.userId);
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

  async deleteForUserById(input: { userId: string; receiverId: string; deletedAt: Date }): Promise<ReceiverRecord | null> {
    const record = this.records.find((receiver) => receiver.id === input.receiverId && receiver.userId === input.userId);
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
}

class InMemoryCheckInsRepository implements CheckInsRepository {
  public openCheckIn: CheckInRecord | null = null;
  public responseUpdate:
    | {
        checkInId: string;
        status: CheckInStatus;
        respondedAt: Date;
        responseDetectedAs: 'ok' | 'help';
        responseTranscript: string;
      }
    | null = null;

  async findReceiversDueForCheckIn(_now: Date): Promise<CheckInReceiverCandidate[]> {
    return [];
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

  async markSent(input: MarkCheckInSentInput): Promise<CheckInRecord> {
    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: input.sentAt,
      status: CheckInStatus.SENT,
      channelUsed: input.channel,
      sentAt: input.sentAt,
      createdAt: input.sentAt,
      updatedAt: input.sentAt,
    };
  }

  async findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    return this.openCheckIn?.receiverId === receiverId ? this.openCheckIn : null;
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
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: 'audit-1',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }
}

describe('ReceiverReplyService', () => {
  it('grants consent when a pending receiver replies YES', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    repository.records.push(receiverFixture(crypto));
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
    repository.records.push(receiverFixture(crypto));
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
    repository.records.push({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverReplyService(
      repository,
      new InMemoryCheckInsRepository(),
      crypto,
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
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
    const audit = new InMemoryAuditService();
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
      audit as unknown as AuditService,
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
