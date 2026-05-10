import { Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaCheckInsRepository } from './prisma-check-ins.repository';

function checkInAttemptMock() {
  return {
    createManyAndReturn: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
}

describe('PrismaCheckInsRepository', () => {
  it('returns granted, unpaused receivers whose schedule is due in their local timezone', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: 'sender-user-1',
        phoneEncrypted: 'encrypted-phone',
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        pausedUntil: null,
        deletedAt: null,
      },
    ]);
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany,
      },
      checkIn: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      checkInAttempt: checkInAttemptMock(),
    });

    const receivers = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

    expect(findMany).toHaveBeenCalledWith({
      where: {
        consentStatus: ConsentStatus.GRANTED,
        deletedAt: null,
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: new Date('2026-04-27T05:30:00.000Z') } }],
        scheduleFrequency: { in: ['daily'] },
        NOT: {
          checkIns: {
            some: {
              scheduledAt: {
                gte: new Date('2026-04-27T00:00:00.000Z'),
                lt: new Date('2026-04-28T00:00:00.000Z'),
              },
            },
          },
        },
      },
    });
    expect(receivers).toEqual([
      {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: 'sender-user-1',
        phoneEncrypted: 'encrypted-phone',
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        pausedUntil: undefined,
        deletedAt: undefined,
      },
    ]);
  });

  it('creates pending check-in records and marks them sent', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: 'PENDING',
      channelUsed: null,
      sentAt: null,
      respondedAt: null,
      responseTranscript: null,
      responseDetectedAs: null,
      resolvedAt: null,
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:30:00.000Z'),
    });
    const update = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: 'SENT',
      channelUsed: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:31:00.000Z'),
      respondedAt: null,
      responseTranscript: null,
      responseDetectedAs: null,
      resolvedAt: null,
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:31:00.000Z'),
    });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: {
        create,
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update,
      },
      checkInAttempt: checkInAttemptMock(),
    });

    await repository.createPending({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
    });
    await repository.markSent({
      checkInId: 'check-in-1',
      channel: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:31:00.000Z'),
      providerMessageId: 'provider-message-1',
      providerStatus: 'accepted',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        status: 'PENDING',
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: {
        status: 'SENT',
        channelUsed: Channel.WHATSAPP,
        sentAt: new Date('2026-04-27T05:31:00.000Z'),
      },
    });
  });

  it('finds the latest open check-in and marks it responded', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: 'SENT',
      channelUsed: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:30:00.000Z'),
      respondedAt: null,
      responseTranscript: null,
      responseDetectedAs: null,
      resolvedAt: null,
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:30:00.000Z'),
    });
    const update = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: 'RESPONDED_OK',
      channelUsed: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:30:00.000Z'),
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseTranscript: 'encrypted-transcript',
      responseDetectedAs: 'ok',
      resolvedAt: null,
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:45:00.000Z'),
    });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: {
        create: vi.fn(),
        findFirst,
        findMany: vi.fn(),
        update,
      },
      checkInAttempt: checkInAttemptMock(),
    });

    await repository.findLatestOpenForReceiver('1aef91f9-64c9-4548-baa5-d70b52386efb');
    await repository.markResponded({
      checkInId: 'check-in-1',
      status: 'RESPONDED_OK',
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseDetectedAs: 'ok',
      responseTranscript: 'encrypted-transcript',
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION] },
      },
      orderBy: { scheduledAt: 'desc' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: {
        status: 'RESPONDED_OK',
        respondedAt: new Date('2026-04-27T05:45:00.000Z'),
        responseDetectedAs: 'ok',
        responseTranscript: 'encrypted-transcript',
      },
    });
  });

  it('finds latest actionable check-in and marks it resolved by backup contact', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.ESCALATED,
      channelUsed: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:30:00.000Z'),
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseTranscript: null,
      responseDetectedAs: 'help',
      resolvedAt: null,
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T05:45:00.000Z'),
    });
    const update = vi.fn().mockResolvedValue({
      id: 'check-in-1',
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.RESOLVED,
      channelUsed: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:30:00.000Z'),
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseTranscript: null,
      responseDetectedAs: 'help',
      resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
      resolutionNote: null,
      resolutionByUserId: null,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      updatedAt: new Date('2026-04-27T06:30:00.000Z'),
    });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: {
        create: vi.fn(),
        findFirst,
        findMany: vi.fn(),
        update,
      },
      checkInAttempt: checkInAttemptMock(),
    });

    await repository.findLatestActionableForReceiver('receiver-1');
    const resolved = await repository.markResolvedByBackupContact({
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
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
      },
      orderBy: { scheduledAt: 'desc' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: {
        status: CheckInStatus.RESOLVED,
        resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
      },
    });
    expect(resolved).toMatchObject({
      id: 'check-in-1',
      status: CheckInStatus.RESOLVED,
      resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
    });
  });

  it('finds sent check-ins that are older than the response window', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'check-in-1',
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-29T10:00:00.000Z'),
        status: CheckInStatus.SENT,
        channelUsed: Channel.WHATSAPP,
        sentAt: new Date('2026-04-29T10:00:00.000Z'),
        respondedAt: null,
        responseTranscript: null,
        responseDetectedAs: null,
        resolvedAt: null,
        resolutionNote: null,
        resolutionByUserId: null,
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany,
        update: vi.fn(),
      },
      checkInAttempt: checkInAttemptMock(),
    });

    const overdue = await repository.findOverdueSentCheckIns({
      overdueBefore: new Date('2026-04-29T10:30:00.000Z'),
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: CheckInStatus.SENT,
        sentAt: {
          lte: new Date('2026-04-29T10:30:00.000Z'),
        },
      },
      orderBy: { sentAt: 'asc' },
    });
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      id: 'check-in-1',
      receiverId: 'receiver-1',
      status: CheckInStatus.SENT,
      sentAt: new Date('2026-04-29T10:00:00.000Z'),
    });
  });
});
