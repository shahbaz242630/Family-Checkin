import { ActorType, Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { CreateReceiverRecordInput, ReceiverRecord, ReceiversRepository } from './receivers.repository';
import { ReceiversService } from './receivers.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public lastInput: CreateReceiverRecordInput | null = null;

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    this.lastInput = input;
    return {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
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
});
