import { Channel, ConsentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaCheckInsRepository } from './prisma-check-ins.repository';

describe('PrismaCheckInsRepository', () => {
  it('returns granted, unpaused receivers whose schedule is due in their local timezone', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        phoneEncrypted: 'encrypted-phone',
        language: 'en',
        timezone: 'Asia/Dubai',
        primaryChannel: Channel.WHATSAPP,
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
        update: vi.fn(),
      },
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
        phoneEncrypted: 'encrypted-phone',
        language: 'en',
        timezone: 'Asia/Dubai',
        primaryChannel: Channel.WHATSAPP,
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
        update,
      },
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
        update,
      },
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
        status: { in: ['PENDING', 'SENT'] },
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
});
