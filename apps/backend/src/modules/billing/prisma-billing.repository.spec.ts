import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaBillingRepository } from './prisma-billing.repository';

describe('PrismaBillingRepository', () => {
  it('records new RevenueCat event ids as idempotency keys', async () => {
    const create = vi.fn().mockResolvedValue({});
    const repository = new PrismaBillingRepository({
      user: { findFirst: vi.fn() },
      subscription: { findFirst: vi.fn(), upsert: vi.fn() },
      idempotencyKey: { create },
    } as never);

    await expect(
      repository.recordRevenueCatEventProcessed({
        eventId: 'event-1',
        expiresAt: new Date('2026-08-07T12:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      data: {
        key: 'revenuecat:event-1',
        scope: 'billing.revenuecat_webhook',
        expiresAt: new Date('2026-08-07T12:00:00.000Z'),
      },
    });
  });

  it('returns false for duplicate RevenueCat event ids', async () => {
    const create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const repository = new PrismaBillingRepository({
      user: { findFirst: vi.fn() },
      subscription: { findFirst: vi.fn(), upsert: vi.fn() },
      idempotencyKey: { create },
    } as never);

    await expect(
      repository.recordRevenueCatEventProcessed({
        eventId: 'event-1',
        expiresAt: new Date('2026-08-07T12:00:00.000Z'),
      }),
    ).resolves.toBe(false);
  });
});
