import { Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaEscalationsRepository } from './prisma-escalations.repository';

describe('PrismaEscalationsRepository', () => {
  it('loads active backup contacts for a receiver in priority order', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaEscalationsRepository({
      backupContact: { findMany },
      escalationEvent: { create: vi.fn() },
      checkIn: { update: vi.fn() },
    });

    await repository.findActiveBackupContactsForReceiver({ receiverId: 'receiver-1' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        receiverId: 'receiver-1',
        deletedAt: null,
      },
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('creates an escalation event without raw PII', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'event-1',
      checkInId: 'check-in-1',
      attemptNumber: 1,
      channel: Channel.SMS,
      startedAt: new Date('2026-04-29T10:00:00.000Z'),
      completedAt: new Date('2026-04-29T10:01:00.000Z'),
      result: EscalationResult.SUCCESS,
      errorDetails: null,
      senderNotifiedAt: null,
      backupAlertedAt: new Date('2026-04-29T10:00:30.000Z'),
    });
    const repository = new PrismaEscalationsRepository({
      backupContact: { findMany: vi.fn() },
      escalationEvent: { create },
      checkIn: { update: vi.fn() },
    });

    await repository.createEvent({
      checkInId: 'check-in-1',
      attemptNumber: 1,
      channel: Channel.SMS,
      startedAt: new Date('2026-04-29T10:00:00.000Z'),
      completedAt: new Date('2026-04-29T10:01:00.000Z'),
      result: EscalationResult.SUCCESS,
      backupAlertedAt: new Date('2026-04-29T10:00:30.000Z'),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T10:01:00.000Z'),
        result: EscalationResult.SUCCESS,
        errorDetails: undefined,
        backupAlertedAt: new Date('2026-04-29T10:00:30.000Z'),
      },
    });
  });

  it('marks a check-in escalated', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'check-in-1', status: CheckInStatus.ESCALATED });
    const repository = new PrismaEscalationsRepository({
      backupContact: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { update },
    });

    await repository.markCheckInEscalated({ checkInId: 'check-in-1' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: { status: CheckInStatus.ESCALATED },
    });
  });

  it('marks a check-in terminal after a missed escalation cannot continue', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'check-in-1', status: CheckInStatus.SKIPPED });
    const repository = new PrismaEscalationsRepository({
      backupContact: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { update },
    });

    await repository.markCheckInTerminal({ checkInId: 'check-in-1', status: CheckInStatus.SKIPPED });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'check-in-1' },
      data: { status: CheckInStatus.SKIPPED },
    });
  });
});
