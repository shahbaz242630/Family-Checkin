import { AbuseReportStatus, ActorType, Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type {
  CreateReceiverRecordInput,
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

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    this.lastInput = input;
    return {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }

  async findActiveByPhoneHash(_phoneHash: string): Promise<ReceiverRecord | null> {
    return null;
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

  async deleteForUserById(input: { userId: string; receiverId: string; deletedAt: Date }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = this.receiversForUser.find((item) => item.id === input.receiverId && item.userId === input.userId);
    return receiver
      ? {
          ...receiver,
          deletedAt: input.deletedAt,
        }
      : null;
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
    await expect(service.createForSender({ ...baseInput, primaryChannel: undefined as unknown as Channel })).rejects.toThrow(
      'Receiver primary channel is required',
    );
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
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('pauses a receiver for a sender and audits the action', async () => {
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

    const receiver = await service.pauseForSender({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: '9999-12-31T23:59:59.999Z',
      pausedReason: 'USER_PAUSED',
    });
    expect(audit.events.at(-1)).toEqual({
      entityType: 'receiver',
      entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'receiver.paused',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: {
        pausedReason: 'USER_PAUSED',
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

  it('soft deletes a receiver for a sender and audits the action', async () => {
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
});
