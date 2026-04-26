import { ActorType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAuditRepository } from './prisma-audit.repository';

describe('PrismaAuditRepository', () => {
  it('creates audit logs without update or delete paths', async () => {
    const create = vi.fn().mockResolvedValue({
      id: '04dc851f-5cb1-4d3c-9d6b-1b015b9af62f',
      entityType: 'receiver',
      entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
      action: 'receiver.created',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: { consentStatus: 'PENDING' },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
    });
    const prisma = {
      auditLog: {
        create,
      },
    };
    const repository = new PrismaAuditRepository(prisma);

    await repository.append({
      entityType: 'receiver',
      entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
      action: 'receiver.created',
      actorType: ActorType.USER,
      actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      metadata: { consentStatus: 'PENDING' },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        entityType: 'receiver',
        entityId: 'a53aa41b-7e7d-4216-a3d9-8fe665b31a77',
        action: 'receiver.created',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: { consentStatus: 'PENDING' },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    });
  });
});
