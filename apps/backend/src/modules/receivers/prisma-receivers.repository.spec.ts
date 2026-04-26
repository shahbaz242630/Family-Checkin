import { Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaReceiversRepository } from './prisma-receivers.repository';

describe('PrismaReceiversRepository', () => {
  it('creates receiver records', async () => {
    const create = vi.fn().mockResolvedValue({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      scheduleCustomCron: null,
      personalNoteEncrypted: null,
      consentStatus: ConsentStatus.PENDING,
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const update = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        update,
      },
    });

    await repository.create({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      nameEncrypted: 'encrypted-name',
      phoneEncrypted: 'encrypted-phone',
      phoneHash: 'phone-hash',
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
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        nameEncrypted: 'encrypted-name',
        phoneEncrypted: 'encrypted-phone',
        phoneHash: 'phone-hash',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        scheduleCustomCron: undefined,
        personalNoteEncrypted: undefined,
        consentStatus: ConsentStatus.PENDING,
      },
    });
  });
});
