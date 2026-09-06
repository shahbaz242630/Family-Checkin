import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { PrismaNotificationsRepository } from './prisma-notifications.repository';

function repositoryWith(overrides: Partial<Record<'createMany' | 'findMany' | 'deleteMany', Mock>>) {
  const expoPushTicket = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    ...overrides,
  };
  const repository = new PrismaNotificationsRepository({
    deviceToken: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    expoPushTicket,
  } as never);

  return { repository, expoPushTicket };
}

describe('PrismaNotificationsRepository push tickets (CB-023)', () => {
  it('stores tickets in one insert and ignores an id Expo already handed out', async () => {
    const { repository, expoPushTicket } = repositoryWith({});

    await repository.recordPushTickets({
      tickets: [
        { ticketId: 'ticket-1', token: 'ExpoPushToken[a]' },
        { ticketId: 'ticket-2', token: 'ExpoPushToken[b]' },
      ],
      createdAt: new Date('2026-09-06T10:00:00.000Z'),
    });
    await repository.recordPushTickets({ tickets: [], createdAt: new Date('2026-09-06T10:00:00.000Z') });

    expect(expoPushTicket.createMany).toHaveBeenCalledTimes(1);
    expect(expoPushTicket.createMany).toHaveBeenCalledWith({
      data: [
        { ticketId: 'ticket-1', token: 'ExpoPushToken[a]', createdAt: new Date('2026-09-06T10:00:00.000Z') },
        { ticketId: 'ticket-2', token: 'ExpoPushToken[b]', createdAt: new Date('2026-09-06T10:00:00.000Z') },
      ],
      skipDuplicates: true,
    });
  });

  it('reads the oldest tickets created before the cut-off, up to the limit', async () => {
    const { repository, expoPushTicket } = repositoryWith({
      findMany: vi
        .fn()
        .mockResolvedValue([
          { ticketId: 'ticket-1', token: 'ExpoPushToken[a]', createdAt: new Date('2026-09-06T09:00:00.000Z') },
        ]),
    });

    const tickets = await repository.findPushTicketsCreatedBefore({
      before: new Date('2026-09-06T09:45:00.000Z'),
      limit: 300,
    });

    expect(expoPushTicket.findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-09-06T09:45:00.000Z') } },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    expect(tickets).toEqual([
      { ticketId: 'ticket-1', token: 'ExpoPushToken[a]', createdAt: new Date('2026-09-06T09:00:00.000Z') },
    ]);
  });

  it('deletes processed tickets by id and skips the query for none', async () => {
    const { repository, expoPushTicket } = repositoryWith({});

    await repository.deletePushTickets({ ticketIds: ['ticket-1', 'ticket-2'] });
    await repository.deletePushTickets({ ticketIds: [] });

    expect(expoPushTicket.deleteMany).toHaveBeenCalledTimes(1);
    expect(expoPushTicket.deleteMany).toHaveBeenCalledWith({ where: { ticketId: { in: ['ticket-1', 'ticket-2'] } } });
  });
});
