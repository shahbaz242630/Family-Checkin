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
import type { ChannelRouterService } from '../channels/channel-router.service';
import type { CheckInsService } from '../check-ins/check-ins.service';
import type { EscalateSenderRequestedBackupResult, EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { CheckInsRepository } from '../check-ins/check-ins.repository';
import {
  CheckInInProgressError,
  OptOutCooldownError,
  ReceiverAlreadyMonitoredError,
  RESOLUTION_NOTE_TOO_LONG_MESSAGE,
} from './receiver-policy';
import type {
  CreateReceiverRecordInput,
  OptOutCooldownRecord,
  ReceiverRecord,
  ReceiversRepository,
  ReceiverWithLatestCheckInRecord,
  UpdateReceiverRecordInput,
} from './receivers.repository';
import { ReceiversService } from './receivers.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public lastInput: CreateReceiverRecordInput | null = null;
  public receiversForUser: ReceiverWithLatestCheckInRecord[] = [];
  /** Rows any sender holds for a phone hash; `create` consults these for CB-014. */
  public activeByPhoneHash: ReceiverRecord[] = [];
  public optOutCooldown: OptOutCooldownRecord | null = null;
  public lastResolveInput: { checkInId: string; resolutionNote?: string } | null = null;
  public resolutionNotes: Array<{ checkInId: string; resolutionNote: string }> = [];

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    this.lastInput = input;
    return {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }

  async findActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord | null> {
    return this.activeByPhoneHash.find((receiver) => receiver.phoneHash === phoneHash) ?? null;
  }

  async findManyActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord[]> {
    return this.activeByPhoneHash.filter((receiver) => receiver.phoneHash === phoneHash);
  }

  async findActiveById(receiverId: string): Promise<ReceiverRecord | null> {
    return this.receiversForUser.find((receiver) => receiver.id === receiverId) ?? null;
  }

  async findOptOutCooldownByPhoneHash(_phoneHash: string): Promise<OptOutCooldownRecord | null> {
    return this.optOutCooldown;
  }

  async setCheckInResolutionNote(input: { checkInId: string; resolutionNote: string }): Promise<void> {
    this.resolutionNotes.push(input);
  }

  async findManyForUser(_userId: string): Promise<ReceiverWithLatestCheckInRecord[]> {
    return this.receiversForUser;
  }

  async findForUserById(input: { receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null> {
    return this.receiversForUser.find((receiver) => receiver.id === input.receiverId) ?? null;
  }

  async updateForUserById(input: UpdateReceiverRecordInput): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId && item.userId === input.userId);
    if (!receiver) {
      return null;
    }

    return {
      ...receiver,
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
    };
  }

  async pauseForUserById(input: {
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId);
    return receiver
      ? {
          ...receiver,
          pausedUntil: input.pausedUntil,
          pausedReason: input.pausedReason,
        }
      : null;
  }

  async resumeForUserById(input: { receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId);
    return receiver
      ? {
          ...receiver,
          pausedUntil: undefined,
          pausedReason: undefined,
        }
      : null;
  }

  async deleteForUserById(input: {
    userId: string;
    receiverId: string;
    deletedAt: Date;
  }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId && item.userId === input.userId);
    return receiver
      ? {
          ...receiver,
          deletedAt: input.deletedAt,
        }
      : null;
  }

  async resolveCheckInForUserById(input: {
    userId: string;
    receiverId: string;
    checkInId: string;
    resolvedAt: Date;
    resolutionByUserId: string;
    resolutionNote?: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null> {
    this.lastResolveInput = { checkInId: input.checkInId, resolutionNote: input.resolutionNote };
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId && item.userId === input.userId);
    if (!receiver?.latestCheckIn || receiver.latestCheckIn.id !== input.checkInId) {
      return null;
    }

    const actionableStatuses: CheckInStatus[] = [
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.ESCALATED,
      CheckInStatus.NEEDS_ATTENTION,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ];
    if (!actionableStatuses.includes(receiver.latestCheckIn.status)) {
      return null;
    }

    return {
      ...receiver,
      latestCheckIn: {
        ...receiver.latestCheckIn,
        status: CheckInStatus.RESOLVED,
        resolvedAt: input.resolvedAt,
        resolutionByUserId: input.resolutionByUserId,
        resolutionNote: input.resolutionNote ?? receiver.latestCheckIn.resolutionNote,
      },
    };
  }

  async markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord> {
    if (!this.lastInput) {
      throw new Error('Receiver has not been created');
    }

    return {
      id: input.receiverId,
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...this.lastInput,
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
    if (!this.lastInput) {
      throw new Error('Receiver has not been created');
    }

    return {
      id: input.receiverId,
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...this.lastInput,
      consentStatus: input.consentStatus,
      consentTranscript: input.consentTranscript,
      consentGrantedAt: input.consentGrantedAt,
      consentRevokedAt: input.consentRevokedAt,
    };
  }

  async upsertOptOutCooldown(_input: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  }): Promise<void> {}

  async createAbuseReport(input: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }> {
    return {
      id: 'abuse-report-1',
      receiverId: input.receiverId,
      reviewStatus: AbuseReportStatus.PENDING,
      reportedAt: input.reportedAt,
    };
  }

  async pauseForAbuseReview(input: { receiverId: string; pausedReason: string }): Promise<ReceiverRecord> {
    if (!this.lastInput) {
      throw new Error('Receiver has not been created');
    }

    return {
      id: input.receiverId,
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...this.lastInput,
      pausedReason: input.pausedReason,
    };
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: '04dc851f-5cb1-4d3c-9d6b-1b015b9af62f',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }
}

class InMemoryEscalationsService {
  public senderRequestedBackups: Array<{ receiverId: string; checkInId: string }> = [];
  /** What the fan-out reports back; the service must hand it to the controller untouched (CB-074). */
  public result: EscalateSenderRequestedBackupResult = { outcome: 'alerted', alerted: 1, failed: 0 };

  async escalateSenderRequestedBackup(input: {
    receiverId: string;
    checkInId: string;
  }): Promise<EscalateSenderRequestedBackupResult> {
    this.senderRequestedBackups.push(input);
    return this.result;
  }
}

class InMemoryChannelRouter {
  public messages: Array<{
    channel: Channel;
    to: string;
    message: {
      templateKey: string;
      language: string;
      variables: Record<string, string>;
    };
  }> = [];
  public calls: Array<{
    channel: Channel;
    to: string;
    script: {
      scriptKey: string;
      language: string;
      variables: Record<string, string>;
    };
  }> = [];
  public availability = new Map<Channel, boolean>();

  async sendMessage(
    channel: Channel,
    to: string,
    message: { templateKey: string; language: string; variables: Record<string, string> },
  ) {
    this.messages.push({ channel, to, message });
    return {
      providerMessageId: 'message-1',
      acceptedAt: new Date('2026-05-07T10:00:00.000Z'),
      providerStatus: 'accepted' as const,
    };
  }

  async makeVoiceCall(
    channel: Channel,
    to: string,
    script: { scriptKey: string; language: string; variables: Record<string, string> },
  ) {
    this.calls.push({ channel, to, script });
    return {
      providerCallId: 'call-1',
      acceptedAt: new Date('2026-05-07T10:00:00.000Z'),
      providerStatus: 'accepted' as const,
    };
  }

  async resolveReachablePlan(input: { phone: string; primaryChannel: Channel; fallbackChannels: Channel[] }) {
    const channels = [input.primaryChannel, ...input.fallbackChannels].filter(
      (channel, index, all) => all.indexOf(channel) === index,
    );
    const unavailableChannels: Channel[] = [];
    for (const channel of channels) {
      if (this.availability.get(channel) ?? true) {
        return {
          primaryChannel: channel,
          fallbackChannels: channels.filter(
            (candidate) => candidate !== channel && !unavailableChannels.includes(candidate),
          ),
          detectionStatus: channel === input.primaryChannel ? 'PRIMARY_AVAILABLE' : 'FALLBACK_SELECTED',
          unavailableChannels,
          detectionConfidence: 'provider_availability_check',
        };
      }
      unavailableChannels.push(channel);
    }

    return {
      primaryChannel: input.primaryChannel,
      fallbackChannels: input.fallbackChannels,
      detectionStatus: 'MANUAL_REQUIRED',
      unavailableChannels,
      detectionConfidence: 'manual_selection',
    };
  }
}

describe('ReceiversService', () => {
  it('creates an encrypted receiver with pending consent and an audit event', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService);

    const receiver = await service.createForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      name: '  Fatima Parent  ',
      phone: '050 123 4567',
      phoneCountry: 'AE',
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
      personalNote: 'Please answer when you are free.',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver.id).toBe('1aef91f9-64c9-4548-baa5-d70b52386efb');
    expect(repository.lastInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS, Channel.VOICE],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.PENDING,
      phoneHash: crypto.hashForLookup('+971501234567'),
    });
    expect(crypto.decrypt(repository.lastInput?.nameEncrypted ?? '')).toBe('Fatima Parent');
    expect(crypto.decrypt(repository.lastInput?.phoneEncrypted ?? '')).toBe('+971501234567');
    expect(crypto.decrypt(repository.lastInput?.personalNoteEncrypted ?? '')).toBe('Please answer when you are free.');
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.created',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          consentStatus: ConsentStatus.PENDING,
          relationshipType: RelationshipType.PARENT,
          primaryChannel: Channel.WHATSAPP,
          fallbackChannelCount: 2,
          scheduleFrequency: 'daily',
          channelDetectionStatus: 'MANUAL_REQUIRED',
          channelDetectionConfidence: 'manual_selection',
          unavailableChannels: [],
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('requires receiver name, phone, and at least one channel', async () => {
    const service = new ReceiversService(
      new InMemoryReceiversRepository(),
      new CryptoService(masterKey),
      new InMemoryAuditService() as unknown as AuditService,
    );
    const baseInput = {
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      name: 'Fatima',
      phone: '0501234567',
      phoneCountry: 'AE',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
    };

    await expect(service.createForSender({ ...baseInput, name: '' })).rejects.toThrow('Receiver name is required');
    await expect(service.createForSender({ ...baseInput, phone: '' })).rejects.toThrow('Receiver phone is required');
    await expect(
      service.createForSender({ ...baseInput, primaryChannel: undefined as unknown as Channel }),
    ).rejects.toThrow('Receiver primary channel is required');
  });

  it('falls back from unavailable WhatsApp during receiver creation and audits the channel plan', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const channelRouter = new InMemoryChannelRouter();
    channelRouter.availability.set(Channel.WHATSAPP, false);
    channelRouter.availability.set(Channel.SMS, true);
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      undefined,
      undefined,
      channelRouter as unknown as ChannelRouterService,
    );

    await service.createForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      name: 'Fatima Parent',
      phone: '+971501234567',
      phoneCountry: 'AE',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS, Channel.VOICE],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
    });

    expect(repository.lastInput).toMatchObject({
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
    });
    expect(audit.events[0]).toMatchObject({
      action: 'receiver.created',
      metadata: {
        primaryChannel: Channel.SMS,
        fallbackChannelCount: 1,
        channelDetectionStatus: 'FALLBACK_SELECTED',
        channelDetectionConfidence: 'provider_availability_check',
        unavailableChannels: [Channel.WHATSAPP],
      },
    });
  });

  it('lists receivers for a sender without exposing encrypted fields or full phone numbers', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        consentGrantedAt: new Date('2026-04-26T09:00:00.000Z'),
        latestCheckIn: {
          id: '49a43e47-4e21-46f1-9fcc-2cf81ca3b41d',
          status: 'RESPONDED_OK',
          scheduledAt: new Date('2026-04-27T10:00:00.000Z'),
          channelUsed: Channel.WHATSAPP,
          sentAt: new Date('2026-04-27T10:01:00.000Z'),
          respondedAt: new Date('2026-04-27T10:02:00.000Z'),
          responseDetectedAs: 'ok',
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    const receivers = await service.listForSender('61a5639c-c902-4950-9924-1a4d6db1e02d');

    expect(receivers).toEqual([
      {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        displayName: 'Fatima Parent',
        phoneMasked: '*******4567',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        consentGrantedAt: '2026-04-26T09:00:00.000Z',
        pausedUntil: undefined,
        pausedReason: undefined,
        scheduleInvalidAt: null,
        latestCheckIn: {
          id: '49a43e47-4e21-46f1-9fcc-2cf81ca3b41d',
          status: 'RESPONDED_OK',
          scheduledAt: '2026-04-27T10:00:00.000Z',
          channelUsed: Channel.WHATSAPP,
          sentAt: '2026-04-27T10:01:00.000Z',
          respondedAt: '2026-04-27T10:02:00.000Z',
          responseDetectedAs: 'ok',
        },
        createdAt: '2026-04-26T08:00:00.000Z',
        updatedAt: '2026-04-27T10:02:00.000Z',
      },
    ]);
    expect(JSON.stringify(receivers)).not.toContain('phoneHash');
    expect(JSON.stringify(receivers)).not.toContain('nameEncrypted');
    expect(JSON.stringify(receivers)).not.toContain('+971501234567');
  });

  it('surfaces the schedule-invalid stamp as an ISO string on the summary and the detail, null when clear (CB-069)', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    const baseReceiver: ReceiverWithLatestCheckInRecord = {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      nameEncrypted: crypto.encrypt('Fatima Parent'),
      phoneEncrypted: crypto.encrypt('+971501234567'),
      phoneHash: crypto.hashForLookup('+971501234567'),
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.GRANTED,
      createdAt: new Date('2026-04-26T08:00:00.000Z'),
      updatedAt: new Date('2026-04-27T10:02:00.000Z'),
    };
    repository.receiversForUser = [
      { ...baseReceiver, scheduleInvalidAt: new Date('2026-09-06T07:10:00.000Z') },
      { ...baseReceiver, id: 'receiver-2', scheduleInvalidAt: undefined },
    ];
    const service = new ReceiversService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    const receivers = await service.listForSender('61a5639c-c902-4950-9924-1a4d6db1e02d');
    const detail = await service.getForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(receivers.map((receiver) => receiver.scheduleInvalidAt)).toEqual(['2026-09-06T07:10:00.000Z', null]);
    expect(detail?.scheduleInvalidAt).toBe('2026-09-06T07:10:00.000Z');
  });

  it('returns receiver detail with latest check-in and placeholder relationship surfaces', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.PENDING,
        consentRequestedAt: new Date('2026-04-26T09:00:00.000Z'),
        latestCheckIn: {
          id: '49a43e47-4e21-46f1-9fcc-2cf81ca3b41d',
          status: 'SENT',
          scheduledAt: new Date('2026-04-27T10:00:00.000Z'),
          channelUsed: Channel.WHATSAPP,
          sentAt: new Date('2026-04-27T10:01:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);

    const receiver = await service.getForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Parent',
      phoneMasked: '*******4567',
      consentStatus: ConsentStatus.PENDING,
      latestCheckIn: {
        id: '49a43e47-4e21-46f1-9fcc-2cf81ca3b41d',
        status: 'SENT',
        scheduledAt: '2026-04-27T10:00:00.000Z',
        channelUsed: Channel.WHATSAPP,
        sentAt: '2026-04-27T10:01:00.000Z',
      },
      backupContacts: [],
      escalation: {
        configured: false,
        nextStep: 'Add backup contacts',
      },
    });
    expect(JSON.stringify(receiver)).not.toContain('+971501234567');
    expect(JSON.stringify(receiver)).not.toContain('phoneHash');
  });

  it('returns null when a sender requests a receiver they do not own', async () => {
    const service = new ReceiversService(
      new InMemoryReceiversRepository(),
      new CryptoService(masterKey),
      new InMemoryAuditService() as unknown as AuditService,
    );

    await expect(
      service.getForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: 'missing-receiver',
      }),
    ).resolves.toBeNull();
  });

  it('updates a receiver for a sender and audits only non-sensitive metadata', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService);

    const receiver = await service.updateForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      name: '  Fatima Updated  ',
      countryCode: 'gb',
      relationshipType: RelationshipType.GRANDPARENT,
      language: 'en-GB',
      timezone: 'Europe/London',
      techProfile: TechProfile.SMS,
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '08:00', end: '10:00' },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Updated',
      countryCode: 'GB',
      relationshipType: RelationshipType.GRANDPARENT,
      language: 'en-GB',
      timezone: 'Europe/London',
      techProfile: TechProfile.SMS,
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
      scheduleTimeWindow: { start: '08:00', end: '10:00' },
    });
    expect(JSON.stringify(receiver)).not.toContain('+971501234567');
    expect(audit.events.at(-1)).toEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.updated',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        countryCode: 'GB',
        relationshipType: RelationshipType.GRANDPARENT,
        primaryChannel: Channel.SMS,
        fallbackChannelCount: 1,
        scheduleFrequency: 'daily',
        channelDetectionStatus: 'MANUAL_REQUIRED',
        channelDetectionConfidence: 'manual_selection',
        unavailableChannels: [],
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('pauses a receiver for a sender, stores the requested end date, notifies the receiver, and audits the action', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const channelRouter = new InMemoryChannelRouter();
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      undefined,
      undefined,
      channelRouter as unknown as ChannelRouterService,
    );

    const receiver = await service.pauseForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: new Date('2026-05-10T18:00:00.000Z'),
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: '2026-05-10T18:00:00.000Z',
      pausedReason: 'USER_PAUSED',
    });
    expect(channelRouter.messages).toEqual([
      {
        channel: Channel.WHATSAPP,
        to: '+971501234567',
        message: {
          templateKey: 'receiver_checkins_paused',
          language: 'en',
          variables: {
            receiverName: 'Fatima Parent',
            senderDisplayName: 'your family member',
          },
        },
      },
    ]);
    expect(audit.events).toContainEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.pause_notification_sent',
      actorType: ActorType.SYSTEM,
      actorId: undefined,
      metadata: {
        channel: Channel.WHATSAPP,
        providerStatus: 'accepted',
      },
      ipAddress: undefined,
      userAgent: undefined,
    });
    expect(audit.events.at(-1)).toEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.paused',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        pausedReason: 'USER_PAUSED',
        pausedUntil: '2026-05-10T18:00:00.000Z',
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('resumes a receiver for a sender and audits the action', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        pausedUntil: new Date('9999-12-31T23:59:59.999Z'),
        pausedReason: 'USER_PAUSED',
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService);

    const receiver = await service.resumeForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: undefined,
      pausedReason: undefined,
    });
    expect(audit.events.at(-1)).toEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.resumed',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {},
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('soft deletes a receiver for a sender, sends the final receiver notice, and audits the action', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const channelRouter = new InMemoryChannelRouter();
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-27T10:02:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      undefined,
      undefined,
      channelRouter as unknown as ChannelRouterService,
    );

    const receiver = await service.deleteForSender({
      userId: '  61a5639c-c902-4950-9924-1a4d6db1e02d  ',
      receiverId: '  1aef91f9-64c9-4548-baa5-d70b52386efb  ',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Parent',
      phoneMasked: '*******4567',
    });
    expect(JSON.stringify(receiver)).not.toContain('+971501234567');
    expect(channelRouter.messages).toEqual([
      {
        channel: Channel.WHATSAPP,
        to: '+971501234567',
        message: {
          templateKey: 'receiver_checkins_ended',
          language: 'en',
          variables: {
            receiverName: 'Fatima Parent',
            senderDisplayName: 'your family member',
          },
        },
      },
    ]);
    expect(audit.events).toContainEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.delete_notification_sent',
      actorType: ActorType.SYSTEM,
      actorId: undefined,
      metadata: {
        channel: Channel.WHATSAPP,
        providerStatus: 'accepted',
      },
      ipAddress: undefined,
      userAgent: undefined,
    });
    expect(audit.events.at(-1)).toEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.deleted',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {},
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('resolves an actionable latest check-in for a sender and audits without PII', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        latestCheckIn: {
          id: 'check-in-1',
          status: CheckInStatus.ESCALATED,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
          channelUsed: Channel.SMS,
          sentAt: new Date('2026-04-30T06:01:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-30T06:01:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      () => new Date('2026-04-30T10:00:00.000Z'),
    );

    const receiver = await service.resolveCheckInForSender({
      userId: '  61a5639c-c902-4950-9924-1a4d6db1e02d  ',
      receiverId: '  1aef91f9-64c9-4548-baa5-d70b52386efb  ',
      checkInId: '  check-in-1  ',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver?.latestCheckIn).toMatchObject({
      id: 'check-in-1',
      status: CheckInStatus.RESOLVED,
      resolvedAt: '2026-04-30T10:00:00.000Z',
      resolutionByUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    });
    expect(audit.events.at(-1)).toEqual({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.resolved',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        resolutionTextPresent: false,
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(JSON.stringify(receiver)).not.toContain('+971501234567');
    expect(JSON.stringify(audit.events)).not.toContain('+971501234567');
  });

  it('returns null when resolving a non-actionable or missing check-in', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        latestCheckIn: {
          id: 'latest-check-in',
          status: CheckInStatus.RESPONDED_OK,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-30T06:01:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      new CryptoService(masterKey),
      new InMemoryAuditService() as unknown as AuditService,
    );

    await expect(
      service.resolveCheckInForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: 'missing-receiver',
        checkInId: 'missing-check-in',
      }),
    ).resolves.toBeNull();
    await expect(
      service.resolveCheckInForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'latest-check-in',
      }),
    ).resolves.toBeNull();
    await expect(
      service.resolveCheckInForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'older-actionable-check-in',
      }),
    ).resolves.toBeNull();
  });

  it('alerts backup contacts for an actionable latest check-in after sender confirmation', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const escalations = new InMemoryEscalationsService();
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        latestCheckIn: {
          id: 'check-in-1',
          status: CheckInStatus.RESPONDED_HELP,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
          channelUsed: Channel.SMS,
          sentAt: new Date('2026-04-30T06:01:00.000Z'),
          respondedAt: new Date('2026-04-30T06:20:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-30T06:20:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      escalations as unknown as EscalationsService,
    );

    const result = await service.alertBackupForSender({
      userId: '  61a5639c-c902-4950-9924-1a4d6db1e02d  ',
      receiverId: '  1aef91f9-64c9-4548-baa5-d70b52386efb  ',
      checkInId: '  check-in-1  ',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(escalations.senderRequestedBackups).toEqual([
      {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
      },
    ]);
    expect(result?.receiver.latestCheckIn).toMatchObject({
      id: 'check-in-1',
      status: CheckInStatus.RESPONDED_HELP,
    });
    expect(result?.backupAlert).toEqual({ outcome: 'alerted', alerted: 1, failed: 0 });
    expect(audit.events[0]).toEqual({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.backup_alert_requested',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        previousStatus: CheckInStatus.RESPONDED_HELP,
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(JSON.stringify(audit.events)).not.toContain('+971501234567');
    expect(JSON.stringify(audit.events)).not.toContain('Fatima Parent');
  });

  it('records try-later for an actionable latest check-in without sending backup alerts', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        latestCheckIn: {
          id: 'check-in-1',
          status: CheckInStatus.SKIPPED,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
          channelUsed: Channel.SMS,
          sentAt: new Date('2026-04-30T06:01:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-30T06:20:00.000Z'),
      },
    ];
    const escalations = new InMemoryEscalationsService();
    const service = new ReceiversService(
      repository,
      crypto,
      audit as unknown as AuditService,
      escalations as unknown as EscalationsService,
    );

    const receiver = await service.tryCheckInLaterForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(escalations.senderRequestedBackups).toEqual([]);
    expect(receiver?.latestCheckIn).toMatchObject({
      id: 'check-in-1',
      status: CheckInStatus.SKIPPED,
    });
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.try_later_requested',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          previousStatus: CheckInStatus.SKIPPED,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('returns null when sender check-in actions target non-actionable or non-latest check-ins', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [
      {
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
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        latestCheckIn: {
          id: 'latest-check-in',
          status: CheckInStatus.RESPONDED_OK,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
        },
        createdAt: new Date('2026-04-26T08:00:00.000Z'),
        updatedAt: new Date('2026-04-30T06:20:00.000Z'),
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      new InMemoryEscalationsService() as unknown as EscalationsService,
    );

    await expect(
      service.alertBackupForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'latest-check-in',
      }),
    ).resolves.toBeNull();
    await expect(
      service.tryCheckInLaterForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'older-check-in',
      }),
    ).resolves.toBeNull();
  });

  it('returns null when deleting a receiver the sender does not own', async () => {
    const service = new ReceiversService(
      new InMemoryReceiversRepository(),
      new CryptoService(masterKey),
      new InMemoryAuditService() as unknown as AuditService,
    );

    await expect(
      service.deleteForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: 'missing-receiver',
      }),
    ).resolves.toBeNull();
  });

  it('rejects a personal note longer than 50 characters before anything is stored, and accepts exactly 50', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const crypto = new CryptoService(masterKey);
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService);
    const input = {
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      name: 'Fatima Parent',
      phone: '050 123 4567',
      phoneCountry: 'AE',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
    };

    await expect(service.createForSender({ ...input, personalNote: `  ${'x'.repeat(51)}  ` })).rejects.toThrow(
      'Receiver personal note must be 50 characters or fewer',
    );
    expect(repository.lastInput).toBeNull();
    expect(audit.events).toEqual([]);

    await service.createForSender({ ...input, personalNote: 'ع'.repeat(50) });
    expect(crypto.decrypt(repository.lastInput?.personalNoteEncrypted ?? '')).toBe('ع'.repeat(50));
  });
});

describe('ReceiversService validates the schedule the cron evaluates (CB-004)', () => {
  const baseInput = {
    userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    name: 'Fatima',
    phone: '0501234567',
    phoneCountry: 'AE',
    countryCode: 'AE',
    relationshipType: RelationshipType.PARENT,
    language: 'en',
    timezone: 'Asia/Dubai',
    techProfile: TechProfile.WHATSAPP,
    primaryChannel: Channel.WHATSAPP,
    fallbackChannels: [],
    scheduleFrequency: 'daily',
    scheduleTimeWindow: { start: '09:00', end: '11:00' },
  };

  function existingReceiver(crypto: CryptoService): ReceiverWithLatestCheckInRecord {
    return {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      userId: baseInput.userId,
      nameEncrypted: crypto.encrypt('Fatima Parent'),
      phoneEncrypted: crypto.encrypt('+971501234567'),
      phoneHash: crypto.hashForLookup('+971501234567'),
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.GRANTED,
      createdAt: new Date('2026-04-26T08:00:00.000Z'),
      updatedAt: new Date('2026-04-27T10:02:00.000Z'),
    };
  }

  it('rejects an unknown timezone or a malformed window on create with a typed code and stores nothing', async () => {
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const service = new ReceiversService(repository, new CryptoService(masterKey), audit as unknown as AuditService);

    await expect(service.createForSender({ ...baseInput, timezone: 'Dubai' })).rejects.toMatchObject({
      name: 'ReceiverScheduleValidationError',
      code: 'INVALID_TIMEZONE',
    });
    await expect(
      service.createForSender({ ...baseInput, scheduleTimeWindow: { start: '9:00', end: '17:00' } }),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE_TIME_WINDOW' });
    await expect(service.createForSender({ ...baseInput, scheduleTimeWindow: {} })).rejects.toMatchObject({
      code: 'INVALID_SCHEDULE_TIME_WINDOW',
    });
    expect(repository.lastInput).toBeNull();
    expect(audit.events).toEqual([]);
  });

  it('rejects them on update too, and stores only the validated start and end on success', async () => {
    const repository = new InMemoryReceiversRepository();
    const crypto = new CryptoService(masterKey);
    repository.receiversForUser = [existingReceiver(crypto)];
    const service = new ReceiversService(repository, crypto, new InMemoryAuditService() as unknown as AuditService);
    const updateInput = {
      userId: baseInput.userId,
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      name: 'Fatima Parent',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '08:00', end: '10:00' },
    };

    await expect(service.updateForSender({ ...updateInput, timezone: 'GMT+4' })).rejects.toMatchObject({
      code: 'INVALID_TIMEZONE',
    });
    await expect(
      service.updateForSender({ ...updateInput, scheduleTimeWindow: { start: '08:00', end: '25:00' } }),
    ).rejects.toMatchObject({ code: 'INVALID_SCHEDULE_TIME_WINDOW' });

    const updated = await service.updateForSender({
      ...updateInput,
      timezone: 'UTC',
      scheduleTimeWindow: { start: '08:00', end: '10:00', label: 'morning' },
    });

    expect(updated).toMatchObject({ timezone: 'UTC', scheduleTimeWindow: { start: '08:00', end: '10:00' } });
  });
});

describe('ReceiversService cancels in-flight check-ins on pause and delete (CB-008)', () => {
  class InMemoryCheckInsService {
    public cancelled: Array<{ receiverId: string; reason: string }> = [];

    async cancelOpenCheckInsForReceiver(input: { receiverId: string; reason: string }) {
      this.cancelled.push(input);
      return { cancelled: 1, skippedAttempts: 2 };
    }
  }

  function serviceWith(
    checkIns: InMemoryCheckInsService,
    crypto: CryptoService,
    repository: InMemoryReceiversRepository,
  ) {
    return new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      undefined,
      undefined,
      new InMemoryChannelRouter() as unknown as ChannelRouterService,
      checkIns as unknown as CheckInsService,
    );
  }

  function receiverRow(crypto: CryptoService): ReceiverWithLatestCheckInRecord {
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
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.GRANTED,
      createdAt: new Date('2026-04-26T08:00:00.000Z'),
      updatedAt: new Date('2026-04-27T10:02:00.000Z'),
    };
  }

  it('cancels the open check-ins of a paused receiver with the pause reason', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsService();
    repository.receiversForUser = [receiverRow(crypto)];

    await serviceWith(checkIns, crypto, repository).pauseForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(checkIns.cancelled).toEqual([
      { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', reason: 'receiver_paused' },
    ]);
  });

  it('cancels the open check-ins of a deleted receiver with the delete reason', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsService();
    repository.receiversForUser = [receiverRow(crypto)];

    await serviceWith(checkIns, crypto, repository).deleteForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(checkIns.cancelled).toEqual([
      { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', reason: 'receiver_deleted' },
    ]);
  });

  it("cancels nothing when the receiver is not the sender's", async () => {
    const crypto = new CryptoService(masterKey);
    const checkIns = new InMemoryCheckInsService();

    await serviceWith(checkIns, crypto, new InMemoryReceiversRepository()).pauseForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: 'missing-receiver',
    });

    expect(checkIns.cancelled).toEqual([]);
  });
});

function grantedReceiverRow(crypto: CryptoService, latestCheckIn?: ReceiverWithLatestCheckInRecord['latestCheckIn']) {
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
    fallbackChannels: [Channel.SMS],
    scheduleFrequency: 'daily',
    scheduleTimeWindow: { start: '09:00', end: '11:00' },
    consentStatus: ConsentStatus.GRANTED,
    latestCheckIn,
    createdAt: new Date('2026-04-26T08:00:00.000Z'),
    updatedAt: new Date('2026-04-30T06:20:00.000Z'),
  } satisfies ReceiverWithLatestCheckInRecord;
}

const createInput = {
  userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
  name: 'Fatima Parent',
  phone: '+971501234567',
  countryCode: 'AE',
  relationshipType: RelationshipType.PARENT,
  language: 'en',
  timezone: 'Asia/Dubai',
  techProfile: TechProfile.WHATSAPP,
  primaryChannel: Channel.WHATSAPP,
  fallbackChannels: [Channel.SMS],
  scheduleFrequency: 'daily',
  scheduleTimeWindow: { start: '09:00', end: '11:00' },
};

describe('ReceiversService refuses to invite a phone that opted out or is monitored elsewhere (CB-009, CB-014)', () => {
  const now = () => new Date('2026-05-01T10:00:00.000Z');

  it('returns the cooldown end instead of creating a receiver while the STOP cooldown is running', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    repository.optOutCooldown = {
      receiverId: '2bef91f9-64c9-4548-baa5-d70b52386efc',
      optOutAt: new Date('2026-04-30T10:00:00.000Z'),
      cooldownUntil: new Date('2026-05-07T10:00:00.000Z'),
    };
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService, now);

    const error = await service.createForSender(createInput).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(OptOutCooldownError);
    expect((error as OptOutCooldownError).cooldownUntil).toEqual(new Date('2026-05-07T10:00:00.000Z'));
    expect((error as OptOutCooldownError).details).toEqual({ cooldownUntil: '2026-05-07T10:00:00.000Z' });
    expect(repository.lastInput).toBeNull();
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '2bef91f9-64c9-4548-baa5-d70b52386efc',
        action: 'receiver.create_rejected',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: { reason: 'opt_out_cooldown', cooldownUntil: '2026-05-07T10:00:00.000Z' },
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+971501234567');
  });

  it('creates the receiver once the cooldown has lapsed', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    repository.optOutCooldown = {
      receiverId: '2bef91f9-64c9-4548-baa5-d70b52386efc',
      optOutAt: new Date('2026-04-20T10:00:00.000Z'),
      cooldownUntil: new Date('2026-04-27T10:00:00.000Z'),
    };
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      now,
    );

    const receiver = await service.createForSender(createInput);

    expect(receiver.consentStatus).toBe(ConsentStatus.PENDING);
    expect(repository.lastInput?.phoneHash).toBe(crypto.hashForLookup('+971501234567'));
  });

  it("refuses the phone while another sender's active receiver has it", async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    repository.activeByPhoneHash = [
      {
        ...grantedReceiverRow(crypto),
        id: '3cef91f9-64c9-4548-baa5-d70b52386efd',
        userId: 'other-sender',
        consentStatus: ConsentStatus.REVOKED,
      },
    ];
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService, now);

    await expect(service.createForSender(createInput)).rejects.toBeInstanceOf(ReceiverAlreadyMonitoredError);
    expect(repository.lastInput).toBeNull();
    expect(audit.events).toEqual([
      expect.objectContaining({
        entityType: 'receiver',
        entityId: '3cef91f9-64c9-4548-baa5-d70b52386efd',
        action: 'receiver.create_rejected',
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: { reason: 'already_monitored' },
      }),
    ]);
  });

  it("does not treat the sender's own existing receiver for that phone as another sender's", async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    repository.activeByPhoneHash = [{ ...grantedReceiverRow(crypto), consentStatus: ConsentStatus.DECLINED }];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      now,
    );

    await expect(service.createForSender(createInput)).resolves.toMatchObject({ consentStatus: ConsentStatus.PENDING });
  });
});

describe('ReceiversService sender check-in actions respect the running cascade (CB-017)', () => {
  class InMemoryCheckInsRepository {
    public pending: Array<{ receiverId: string; scheduledAt: Date; retryOf?: string; scheduledLocalDate?: string }> =
      [];
    public attempts: Array<{ checkInId: string; attemptNumber: number; channel: Channel; scheduledAt: Date }> = [];

    async createPending(input: {
      receiverId: string;
      scheduledAt: Date;
      retryOf?: string;
      scheduledLocalDate?: string;
    }) {
      this.pending.push(input);
      return {
        id: 'retry-check-in-1',
        receiverId: input.receiverId,
        scheduledAt: input.scheduledAt,
        status: CheckInStatus.PENDING,
        createdAt: input.scheduledAt,
        updatedAt: input.scheduledAt,
      };
    }

    async createAttempts(
      input: Array<{ checkInId: string; attemptNumber: number; channel: Channel; scheduledAt: Date }>,
    ) {
      this.attempts.push(...input);
      return [];
    }
  }

  const now = () => new Date('2026-04-30T10:00:00.000Z');

  function serviceWith(
    repository: InMemoryReceiversRepository,
    checkIns: InMemoryCheckInsRepository,
    audit: InMemoryAuditService,
  ) {
    return new ReceiversService(
      repository,
      new CryptoService(masterKey),
      audit as unknown as AuditService,
      checkIns as unknown as Pick<CheckInsRepository, 'createPending' | 'createAttempts'>,
      now,
    );
  }

  it('schedules the try-later retry two hours ahead and links it to the check-in it retries', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.NEEDS_ATTENTION,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
      }),
    ];

    const receiver = await serviceWith(repository, checkIns, audit).tryCheckInLaterForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
    });

    expect(receiver?.latestCheckIn?.id).toBe('check-in-1');
    // The retry row is exempt from the once-per-local-day dedupe through `retryOf` and records the receiver's own
    // day (12:00Z is 16:00 in Asia/Dubai), not the UTC default (CB-013).
    expect(checkIns.pending).toEqual([
      {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        scheduledAt: new Date('2026-04-30T12:00:00.000Z'),
        retryOf: 'check-in-1',
        scheduledLocalDate: '2026-04-30',
      },
    ]);
    expect(checkIns.attempts[0]).toMatchObject({
      checkInId: 'retry-check-in-1',
      attemptNumber: 1,
      channel: Channel.WHATSAPP,
      scheduledAt: new Date('2026-04-30T12:00:00.000Z'),
    });
    expect(audit.events[0]).toMatchObject({
      action: 'check_in.try_later_requested',
      metadata: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        previousStatus: CheckInStatus.NEEDS_ATTENTION,
        retryAt: '2026-04-30T12:00:00.000Z',
      },
    });
  });

  it('refuses try-later while the latest check-in is still SENT, creating and auditing nothing', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const checkIns = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.SENT,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
        sentAt: new Date('2026-04-30T06:01:00.000Z'),
      }),
    ];

    await expect(
      serviceWith(repository, checkIns, audit).tryCheckInLaterForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
      }),
    ).rejects.toBeInstanceOf(CheckInInProgressError);
    expect(checkIns.pending).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it('refuses alert-backup while the latest check-in is still PENDING', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const escalations = new InMemoryEscalationsService();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.PENDING,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
      }),
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      escalations as unknown as EscalationsService,
    );

    await expect(
      service.alertBackupForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
      }),
    ).rejects.toBeInstanceOf(CheckInInProgressError);
    expect(escalations.senderRequestedBackups).toEqual([]);
  });

  it('still answers "not found" for an in-progress check-in that is not the latest one', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'latest-check-in',
        status: CheckInStatus.SENT,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
      }),
    ];

    await expect(
      serviceWith(repository, new InMemoryCheckInsRepository(), new InMemoryAuditService()).tryCheckInLaterForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'older-check-in',
      }),
    ).resolves.toBeNull();
  });
});

describe('ReceiversService hands the backup alert outcome to the sender (CB-074)', () => {
  const crypto = new CryptoService(masterKey);

  function receiverNeedingAttention(): ReceiverWithLatestCheckInRecord {
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
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.GRANTED,
      latestCheckIn: {
        id: 'check-in-1',
        status: CheckInStatus.NEEDS_ATTENTION,
        scheduledAt: new Date('2026-09-06T06:00:00.000Z'),
        channelUsed: Channel.SMS,
        sentAt: new Date('2026-09-06T06:01:00.000Z'),
      },
      createdAt: new Date('2026-04-26T08:00:00.000Z'),
      updatedAt: new Date('2026-09-06T06:20:00.000Z'),
    };
  }

  it.each<EscalateSenderRequestedBackupResult>([
    { outcome: 'no_backup_contacts', alerted: 0, failed: 0 },
    { outcome: 'all_failed', alerted: 0, failed: 2 },
    { outcome: 'alerted', alerted: 2, failed: 1 },
  ])('returns the fan-out result %o next to the refreshed receiver', async (fanOutResult) => {
    const repository = new InMemoryReceiversRepository();
    const escalations = new InMemoryEscalationsService();
    escalations.result = fanOutResult;
    repository.receiversForUser = [receiverNeedingAttention()];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      escalations as unknown as EscalationsService,
    );

    const result = await service.alertBackupForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
    });

    expect(result?.backupAlert).toEqual(fanOutResult);
    expect(result?.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Parent',
    });
    expect(escalations.senderRequestedBackups).toHaveLength(1);
  });

  it('still answers null (404) when the check-in is not actionable, without running the fan-out', async () => {
    const repository = new InMemoryReceiversRepository();
    const escalations = new InMemoryEscalationsService();
    const receiver = receiverNeedingAttention();
    receiver.latestCheckIn = { ...receiver.latestCheckIn!, status: CheckInStatus.RESOLVED };
    repository.receiversForUser = [receiver];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      escalations as unknown as EscalationsService,
    );

    await expect(
      service.alertBackupForSender({
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        checkInId: 'check-in-1',
      }),
    ).resolves.toBeNull();
    expect(escalations.senderRequestedBackups).toEqual([]);
  });
});

describe('ReceiversService stores the resolution note encrypted and returns it to the sender (CB-018)', () => {
  const now = () => new Date('2026-04-30T10:00:00.000Z');

  it('encrypts the note onto the check-in, audits only that a note exists, and returns it decrypted', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.ESCALATED,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
      }),
    ];
    const service = new ReceiversService(repository, crypto, audit as unknown as AuditService, now);

    const receiver = await service.resolveCheckInForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
      note: '  Spoke to her neighbour, she was at the clinic.  ',
    });

    expect(repository.lastResolveInput?.resolutionNote).toBeDefined();
    expect(repository.lastResolveInput?.resolutionNote).not.toContain('neighbour');
    expect(crypto.decrypt(repository.lastResolveInput?.resolutionNote ?? '')).toBe(
      'Spoke to her neighbour, she was at the clinic.',
    );
    expect(receiver?.latestCheckIn).toMatchObject({
      status: CheckInStatus.RESOLVED,
      resolutionNote: 'Spoke to her neighbour, she was at the clinic.',
    });
    expect(audit.events[0]).toMatchObject({
      action: 'check_in.resolved',
      metadata: { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', resolutionTextPresent: true },
    });
    expect(JSON.stringify(audit.events)).not.toContain('neighbour');
  });

  it('rejects a note over 200 characters before touching the check-in, and accepts exactly 200', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.FAILED,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
      }),
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      now,
    );
    const input = {
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
    };

    await expect(service.resolveCheckInForSender({ ...input, note: 'x'.repeat(201) })).rejects.toThrow(
      RESOLUTION_NOTE_TOO_LONG_MESSAGE,
    );
    expect(repository.lastResolveInput).toBeNull();

    const receiver = await service.resolveCheckInForSender({ ...input, note: 'y'.repeat(200) });
    expect(receiver?.latestCheckIn?.resolutionNote).toBe('y'.repeat(200));
  });

  it('decrypts a stored note in receiver detail and leaves it out when there is none', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    repository.receiversForUser = [
      grantedReceiverRow(crypto, {
        id: 'check-in-1',
        status: CheckInStatus.RESOLVED,
        scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
        resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
        resolutionNote: crypto.encrypt('Backup contact reply: DONE, I am with her now'),
      }),
      {
        ...grantedReceiverRow(crypto, {
          id: 'check-in-2',
          status: CheckInStatus.RESPONDED_OK,
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
        }),
        id: 'second-receiver',
      },
    ];
    const service = new ReceiversService(
      repository,
      crypto,
      new InMemoryAuditService() as unknown as AuditService,
      now,
    );

    const withNote = await service.getForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });
    const withoutNote = await service.getForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: 'second-receiver',
    });

    expect(withNote?.latestCheckIn?.resolutionNote).toBe('Backup contact reply: DONE, I am with her now');
    expect(withoutNote?.latestCheckIn).not.toHaveProperty('resolutionNote', expect.anything());
  });
});
