import { AbuseReportStatus, Channel, CheckInStatus, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
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
    const findFirst = vi.fn();
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
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

  it('upserts opt-out cooldown records', async () => {
    const create = vi.fn();
    const findFirst = vi.fn();
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn().mockResolvedValue({});
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.upsertOptOutCooldown({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      optOutAt: new Date('2026-04-26T11:00:00.000Z'),
      cooldownUntil: new Date('2026-05-03T11:00:00.000Z'),
      optOutChannel: Channel.WHATSAPP,
      optOutKeyword: 'STOP',
    });

    expect(optOutCooldownUpsert).toHaveBeenCalledWith({
      where: { receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb' },
      create: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        optOutAt: new Date('2026-04-26T11:00:00.000Z'),
        cooldownUntil: new Date('2026-05-03T11:00:00.000Z'),
        optOutChannel: Channel.WHATSAPP,
        optOutKeyword: 'STOP',
      },
      update: {
        optOutAt: new Date('2026-04-26T11:00:00.000Z'),
        cooldownUntil: new Date('2026-05-03T11:00:00.000Z'),
        optOutChannel: Channel.WHATSAPP,
        optOutKeyword: 'STOP',
      },
    });
  });

  it('finds active receivers for a user with their latest check-in', async () => {
    const create = vi.fn();
    const findFirst = vi.fn();
    const findMany = vi.fn().mockResolvedValue([]);
    const update = vi.fn();
    const updateMany = vi.fn();
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.findManyForUser('61a5639c-c902-4950-9924-1a4d6db1e02d');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      include: {
        checkIns: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds one active receiver scoped to a user with its latest check-in', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.findForUserById({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      include: {
        checkIns: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
    });
  });

  it('pauses one active receiver scoped to a user', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.pauseForUserById({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: new Date('9999-12-31T23:59:59.999Z'),
      pausedReason: 'USER_PAUSED',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      data: {
        pausedUntil: new Date('9999-12-31T23:59:59.999Z'),
        pausedReason: 'USER_PAUSED',
      },
    });
  });

  it('updates one active receiver scoped to a user', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.updateForUserById({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      nameEncrypted: 'encrypted-updated-name',
      countryCode: 'GB',
      relationshipType: RelationshipType.GRANDPARENT,
      language: 'en-GB',
      timezone: 'Europe/London',
      techProfile: TechProfile.SMS,
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '08:00', end: '10:00' },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      data: {
        nameEncrypted: 'encrypted-updated-name',
        countryCode: 'GB',
        relationshipType: RelationshipType.GRANDPARENT,
        language: 'en-GB',
        timezone: 'Europe/London',
        techProfile: TechProfile.SMS,
        primaryChannel: Channel.SMS,
        fallbackChannels: [Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '08:00', end: '10:00' },
        scheduleCustomCron: undefined,
      },
    });
  });

  it('resumes one active receiver scoped to a user', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.resumeForUserById({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      data: {
        pausedUntil: null,
        pausedReason: null,
      },
    });
  });

  it('soft deletes one active receiver scoped to a user', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({
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
      consentStatus: ConsentStatus.GRANTED,
      consentRequestedAt: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      consentTranscript: null,
      pausedUntil: null,
      pausedReason: null,
      deletedAt: null,
      checkIns: [],
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const abuseReportCreate = vi.fn();
    const optOutCooldownUpsert = vi.fn();
    const deletedAt = new Date('2026-04-27T12:00:00.000Z');
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.deleteForUserById({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      deletedAt,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        deletedAt: null,
      },
      data: {
        deletedAt,
      },
    });
  });

  it('resolves an actionable owned check-in through receiver ownership scope', async () => {
    const create = vi.fn();
    const findFirst = vi.fn().mockResolvedValue({
      id: 'receiver-1',
      userId: 'user-1',
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
      consentStatus: ConsentStatus.GRANTED,
      consentRequestedAt: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      consentTranscript: null,
      pausedUntil: null,
      pausedReason: null,
      deletedAt: null,
      checkIns: [
        {
          id: 'check-in-1',
          receiverId: 'receiver-1',
          scheduledAt: new Date('2026-04-30T06:00:00.000Z'),
          status: CheckInStatus.RESOLVED,
          channelUsed: Channel.SMS,
          sentAt: new Date('2026-04-30T06:01:00.000Z'),
          respondedAt: null,
          responseTranscript: null,
          responseDetectedAs: null,
          resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
          resolutionNote: null,
          resolutionByUserId: 'user-1',
          createdAt: new Date('2026-04-30T06:00:00.000Z'),
          updatedAt: new Date('2026-04-30T10:00:00.000Z'),
        },
      ],
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-30T10:00:00.000Z'),
    });
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const checkInUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      checkIn: {
        updateMany: checkInUpdateMany,
      },
      abuseReport: {
        create: vi.fn(),
      },
      optOutCooldown: {
        upsert: vi.fn(),
      },
    });

    const receiver = await repository.resolveCheckInForUserById({
      userId: 'user-1',
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
      resolutionByUserId: 'user-1',
    });

    expect(checkInUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'check-in-1',
        receiverId: 'receiver-1',
        status: { in: [CheckInStatus.RESPONDED_HELP, CheckInStatus.ESCALATED, CheckInStatus.FAILED, CheckInStatus.SKIPPED] },
        receiver: {
          userId: 'user-1',
          deletedAt: null,
        },
      },
      data: {
        status: CheckInStatus.RESOLVED,
        resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
        resolutionByUserId: 'user-1',
      },
    });
    expect(receiver?.latestCheckIn).toMatchObject({
      id: 'check-in-1',
      status: CheckInStatus.RESOLVED,
      resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
      resolutionByUserId: 'user-1',
    });
  });

  it('creates abuse report records', async () => {
    const create = vi.fn();
    const findFirst = vi.fn();
    const findMany = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const abuseReportCreate = vi.fn().mockResolvedValue({
      id: 'abuse-report-1',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      reviewStatus: AbuseReportStatus.PENDING,
      reportedAt: new Date('2026-04-26T11:00:00.000Z'),
    });
    const optOutCooldownUpsert = vi.fn();
    const repository = new PrismaReceiversRepository({
      receiver: {
        create,
        findFirst,
        findMany,
        update,
        updateMany,
      },
      abuseReport: {
        create: abuseReportCreate,
      },
      optOutCooldown: {
        upsert: optOutCooldownUpsert,
      },
    });

    await repository.createAbuseReport({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      reporterPhoneHash: 'phone-hash',
      reportContent: 'encrypted-report',
      reportedAt: new Date('2026-04-26T11:00:00.000Z'),
    });

    expect(abuseReportCreate).toHaveBeenCalledWith({
      data: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        reporterPhoneHash: 'phone-hash',
        reportContent: 'encrypted-report',
        reportedAt: new Date('2026-04-26T11:00:00.000Z'),
      },
    });
  });
});
