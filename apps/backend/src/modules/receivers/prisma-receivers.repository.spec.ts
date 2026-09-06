import {
  AbuseReportStatus,
  Channel,
  CheckInStatus,
  ConsentStatus,
  RelationshipType,
  TechProfile,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ABUSE_REVIEW_PAUSE_REASON, ABUSE_REVIEW_PAUSE_UNTIL } from './abuse-review-pause';
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        findFirst: vi.fn(),
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
        status: {
          in: [
            CheckInStatus.RESPONDED_HELP,
            CheckInStatus.ESCALATED,
            CheckInStatus.NEEDS_ATTENTION,
            CheckInStatus.FAILED,
            CheckInStatus.SKIPPED,
          ],
        },
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
        findFirst: vi.fn(),
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

  it('pauses a reported receiver until the abuse-review sentinel so the scheduler skips it', async () => {
    const update = vi.fn().mockResolvedValue({
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
      pausedUntil: ABUSE_REVIEW_PAUSE_UNTIL,
      pausedReason: ABUSE_REVIEW_PAUSE_REASON,
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T11:00:00.000Z'),
    });
    const repository = new PrismaReceiversRepository({
      receiver: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update,
        updateMany: vi.fn(),
      },
      abuseReport: {
        create: vi.fn(),
      },
      optOutCooldown: {
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
    });

    const receiver = await repository.pauseForAbuseReview({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedReason: ABUSE_REVIEW_PAUSE_REASON,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: '1aef91f9-64c9-4548-baa5-d70b52386efb' },
      data: {
        pausedUntil: ABUSE_REVIEW_PAUSE_UNTIL,
        pausedReason: 'abuse_report_pending_review',
      },
    });
    expect(receiver.pausedUntil).toEqual(ABUSE_REVIEW_PAUSE_UNTIL);
    expect(receiver.pausedReason).toBe('abuse_report_pending_review');
    // Eligibility only reads pausedUntil (check-ins.service.ts isEligible, prisma-check-ins.repository.ts
    // findReceiversDueForCheckIn), so the sentinel must sit in the future to keep the receiver off the schedule.
    expect(ABUSE_REVIEW_PAUSE_UNTIL.getTime()).toBeGreaterThan(Date.now());
  });
});

function receiverRow(overrides: Record<string, unknown> = {}) {
  return {
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
    checkIns: [],
    createdAt: new Date('2026-04-26T10:00:00.000Z'),
    updatedAt: new Date('2026-04-30T10:00:00.000Z'),
    ...overrides,
  };
}

function openCheckIn(id: string, scheduledAt: string) {
  return {
    id,
    receiverId: 'receiver-1',
    scheduledAt: new Date(scheduledAt),
    status: CheckInStatus.SENT,
    channelUsed: Channel.SMS,
    sentAt: new Date(scheduledAt),
    respondedAt: null,
    responseTranscript: null,
    responseDetectedAs: null,
    resolvedAt: null,
    resolutionNote: null,
    resolutionByUserId: null,
    createdAt: new Date(scheduledAt),
    updatedAt: new Date(scheduledAt),
  };
}

function clientWith(overrides: {
  findFirst?: Mock;
  findMany?: Mock;
  checkInUpdateMany?: Mock;
  cooldownFindFirst?: Mock;
}) {
  return {
    receiver: {
      create: vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
      findMany: overrides.findMany ?? vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    checkIn: {
      updateMany: overrides.checkInUpdateMany ?? vi.fn(),
    },
    abuseReport: {
      create: vi.fn(),
    },
    optOutCooldown: {
      findFirst: overrides.cooldownFindFirst ?? vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe('PrismaReceiversRepository counts consent resends in the database (CB-081)', () => {
  const row = {
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
    scheduleInvalidAt: null,
    personalNoteEncrypted: null,
    consentStatus: ConsentStatus.PENDING,
    consentRequestedAt: new Date('2026-09-07T10:00:00.000Z'),
    consentResendCount: 1,
    consentGrantedAt: null,
    consentRevokedAt: null,
    consentTranscript: 'encrypted-transcript',
    pausedUntil: null,
    pausedReason: null,
    deletedAt: null,
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
    updatedAt: new Date('2026-09-07T10:00:00.000Z'),
  };

  function repositoryWith(update: Mock) {
    return new PrismaReceiversRepository({
      receiver: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update, updateMany: vi.fn() },
      abuseReport: { create: vi.fn() },
      optOutCooldown: { findFirst: vi.fn(), upsert: vi.fn() },
    });
  }

  it('increments consentResendCount atomically on a resend and reads it back', async () => {
    const update = vi.fn().mockResolvedValue(row);

    const record = await repositoryWith(update).markConsentRequested({
      receiverId: row.id,
      consentRequestedAt: new Date('2026-09-07T10:00:00.000Z'),
      consentTranscript: 'encrypted-transcript',
      resend: true,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: {
        consentRequestedAt: new Date('2026-09-07T10:00:00.000Z'),
        consentTranscript: 'encrypted-transcript',
        consentResendCount: { increment: 1 },
      },
    });
    expect(record.consentResendCount).toBe(1);
  });

  it('leaves the counter alone for a first invitation', async () => {
    const update = vi.fn().mockResolvedValue({ ...row, consentResendCount: 0 });

    const record = await repositoryWith(update).markConsentRequested({
      receiverId: row.id,
      consentRequestedAt: new Date('2026-09-07T10:00:00.000Z'),
      consentTranscript: 'encrypted-transcript',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: {
        consentRequestedAt: new Date('2026-09-07T10:00:00.000Z'),
        consentTranscript: 'encrypted-transcript',
      },
    });
    expect(record.consentResendCount).toBe(0);
  });
});

describe('PrismaReceiversRepository resolves a shared phone hash (CB-014)', () => {
  const openStatuses = [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION];

  it('picks the row with the most recent open check-in even when another row is newer', async () => {
    const findMany = vi.fn().mockResolvedValue([
      receiverRow({ id: 'newer-no-check-in', userId: 'user-2', createdAt: new Date('2026-04-28T10:00:00.000Z') }),
      receiverRow({ id: 'older-with-check-in', checkIns: [openCheckIn('check-in-1', '2026-04-30T06:00:00.000Z')] }),
      receiverRow({
        id: 'oldest-with-stale-check-in',
        createdAt: new Date('2026-04-20T10:00:00.000Z'),
        checkIns: [openCheckIn('check-in-0', '2026-04-29T06:00:00.000Z')],
      }),
    ]);
    const repository = new PrismaReceiversRepository(clientWith({ findMany }));

    const receiver = await repository.findActiveByPhoneHash('phone-hash');

    expect(findMany).toHaveBeenCalledWith({
      where: { phoneHash: 'phone-hash', deletedAt: null },
      include: {
        checkIns: {
          where: { status: { in: openStatuses } },
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(receiver?.id).toBe('older-with-check-in');
    expect(receiver).not.toHaveProperty('checkIns');
  });

  it('falls back to the most recently created row when no row has an open check-in', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        receiverRow({ id: 'newest', createdAt: new Date('2026-04-28T10:00:00.000Z') }),
        receiverRow({ id: 'older' }),
      ]);
    const repository = new PrismaReceiversRepository(clientWith({ findMany }));

    await expect(repository.findActiveByPhoneHash('phone-hash')).resolves.toMatchObject({ id: 'newest' });
  });

  it('returns null when no active row has the hash', async () => {
    const repository = new PrismaReceiversRepository(clientWith({ findMany: vi.fn().mockResolvedValue([]) }));

    await expect(repository.findActiveByPhoneHash('phone-hash')).resolves.toBeNull();
  });

  it('lists every active row for the hash, newest first', async () => {
    const findMany = vi.fn().mockResolvedValue([receiverRow({ id: 'a' }), receiverRow({ id: 'b' })]);
    const repository = new PrismaReceiversRepository(clientWith({ findMany }));

    const receivers = await repository.findManyActiveByPhoneHash('phone-hash');

    expect(findMany).toHaveBeenCalledWith({
      where: { phoneHash: 'phone-hash', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(receivers.map((receiver) => receiver.id)).toEqual(['a', 'b']);
  });

  it('finds one active receiver by id without a sender scope', async () => {
    const findFirst = vi.fn().mockResolvedValue(receiverRow());
    const repository = new PrismaReceiversRepository(clientWith({ findFirst }));

    await expect(repository.findActiveById('receiver-1')).resolves.toMatchObject({
      id: 'receiver-1',
      userId: 'user-1',
    });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'receiver-1', deletedAt: null } });
  });
});

describe('PrismaReceiversRepository reads the opt-out cooldown by phone hash (CB-009)', () => {
  it('returns the latest cooldown across every row that ever had the phone, deleted rows included', async () => {
    const cooldownFindFirst = vi.fn().mockResolvedValue({
      id: 'cooldown-1',
      receiverId: 'receiver-1',
      optOutAt: new Date('2026-04-30T10:00:00.000Z'),
      cooldownUntil: new Date('2026-05-07T10:00:00.000Z'),
      optOutChannel: Channel.SMS,
      optOutKeyword: 'STOP',
    });
    const repository = new PrismaReceiversRepository(clientWith({ cooldownFindFirst }));

    const cooldown = await repository.findOptOutCooldownByPhoneHash('phone-hash');

    expect(cooldownFindFirst).toHaveBeenCalledWith({
      where: { receiver: { phoneHash: 'phone-hash' } },
      orderBy: { cooldownUntil: 'desc' },
    });
    expect(cooldown).toEqual({
      receiverId: 'receiver-1',
      optOutAt: new Date('2026-04-30T10:00:00.000Z'),
      cooldownUntil: new Date('2026-05-07T10:00:00.000Z'),
    });
  });

  it('returns null when the phone never opted out', async () => {
    const repository = new PrismaReceiversRepository(
      clientWith({ cooldownFindFirst: vi.fn().mockResolvedValue(null) }),
    );

    await expect(repository.findOptOutCooldownByPhoneHash('phone-hash')).resolves.toBeNull();
  });
});

describe('PrismaReceiversRepository stores the resolution note (CB-018)', () => {
  it('writes the encrypted note with the sender resolution and reads it back on the latest check-in', async () => {
    const checkInUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue(
      receiverRow({
        checkIns: [
          {
            ...openCheckIn('check-in-1', '2026-04-30T06:00:00.000Z'),
            status: CheckInStatus.RESOLVED,
            resolutionNote: 'enc-note',
          },
        ],
      }),
    );
    const repository = new PrismaReceiversRepository(clientWith({ findFirst, checkInUpdateMany }));

    const receiver = await repository.resolveCheckInForUserById({
      userId: 'user-1',
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
      resolutionByUserId: 'user-1',
      resolutionNote: 'enc-note',
    });

    expect(checkInUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'check-in-1', receiverId: 'receiver-1' },
      data: {
        status: CheckInStatus.RESOLVED,
        resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
        resolutionByUserId: 'user-1',
        resolutionNote: 'enc-note',
      },
    });
    expect(receiver?.latestCheckIn?.resolutionNote).toBe('enc-note');
  });

  it('leaves the note column untouched when the sender gave none', async () => {
    const checkInUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaReceiversRepository(clientWith({ checkInUpdateMany }));

    await repository.resolveCheckInForUserById({
      userId: 'user-1',
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-30T10:00:00.000Z'),
      resolutionByUserId: 'user-1',
    });

    expect(checkInUpdateMany.mock.calls[0]?.[0].data).not.toHaveProperty('resolutionNote');
  });

  it('overwrites the note of one check-in for the backup contact reply', async () => {
    const checkInUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaReceiversRepository(clientWith({ checkInUpdateMany }));

    await repository.setCheckInResolutionNote({ checkInId: 'check-in-1', resolutionNote: 'enc-appended' });

    expect(checkInUpdateMany).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: { resolutionNote: 'enc-appended' },
    });
  });
});
