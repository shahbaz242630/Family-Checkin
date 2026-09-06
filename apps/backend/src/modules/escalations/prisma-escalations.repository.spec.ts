import { Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaEscalationsRepository } from './prisma-escalations.repository';

describe('PrismaEscalationsRepository', () => {
  it('loads active backup contacts for a receiver in priority order', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaEscalationsRepository({
      receiver: { findFirst: vi.fn() },
      backupContact: { findMany },
      checkInAttempt: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { updateMany: vi.fn() },
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
      receiver: { findFirst: vi.fn() },
      backupContact: { findMany: vi.fn() },
      checkInAttempt: { findMany: vi.fn() },
      escalationEvent: { create },
      checkIn: { updateMany: vi.fn() },
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
        senderNotifiedAt: undefined,
        backupAlertedAt: new Date('2026-04-29T10:00:30.000Z'),
      },
    });
  });

  it('finds the active receiver owner for sender push notifications', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      userId: 'sender-1',
      nameEncrypted: 'encrypted-name',
      language: 'ar',
      user: { phoneEncrypted: 'encrypted-phone' },
    });
    const repository = new PrismaEscalationsRepository({
      receiver: { findFirst },
      backupContact: { findMany: vi.fn() },
      checkInAttempt: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { updateMany: vi.fn() },
    });

    await expect(repository.findReceiverOwner({ receiverId: 'receiver-1' })).resolves.toEqual({
      userId: 'sender-1',
      phoneEncrypted: 'encrypted-phone',
      receiverNameEncrypted: 'encrypted-name',
      receiverLanguage: 'ar',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'receiver-1',
        deletedAt: null,
      },
      select: {
        userId: true,
        nameEncrypted: true,
        language: true,
        user: {
          select: {
            phoneEncrypted: true,
          },
        },
      },
    });
  });

  it('lists the channels a check-in cascade already sent on, in attempt order', async () => {
    const findMany = vi.fn().mockResolvedValue([{ channel: Channel.WHATSAPP }, { channel: Channel.SMS }]);
    const repository = new PrismaEscalationsRepository({
      receiver: { findFirst: vi.fn() },
      backupContact: { findMany: vi.fn() },
      checkInAttempt: { findMany },
      escalationEvent: { create: vi.fn() },
      checkIn: { updateMany: vi.fn() },
    });

    await expect(repository.findChannelsTriedForCheckIn({ checkInId: 'check-in-1' })).resolves.toEqual([
      Channel.WHATSAPP,
      Channel.SMS,
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { checkInId: 'check-in-1', sentAt: { not: null } },
      orderBy: { attemptNumber: 'asc' },
      select: { channel: true },
    });
  });

  it('marks a check-in escalated only from an open or actionable status', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new PrismaEscalationsRepository({
      receiver: { findFirst: vi.fn() },
      backupContact: { findMany: vi.fn() },
      checkInAttempt: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { updateMany },
    });

    await repository.markCheckInEscalated({ checkInId: 'check-in-1' });

    // RESPONDED_OK, ESCALATED and RESOLVED are absent: a late escalation never flips an answered or resolved
    // check-in (CB-006).
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'check-in-1',
        status: {
          in: [
            CheckInStatus.SENT,
            CheckInStatus.RESPONDED_HELP,
            CheckInStatus.NEEDS_ATTENTION,
            CheckInStatus.FAILED,
            CheckInStatus.SKIPPED,
          ],
        },
      },
      data: { status: CheckInStatus.ESCALATED },
    });
  });

  it('marks a check-in terminal after a missed escalation cannot continue, but only while it is still open', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaEscalationsRepository({
      receiver: { findFirst: vi.fn() },
      backupContact: { findMany: vi.fn() },
      checkInAttempt: { findMany: vi.fn() },
      escalationEvent: { create: vi.fn() },
      checkIn: { updateMany },
    });

    await expect(
      repository.markCheckInTerminal({ checkInId: 'check-in-1', status: CheckInStatus.SKIPPED }),
    ).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'check-in-1',
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION] },
      },
      data: { status: CheckInStatus.SKIPPED },
    });
  });
});
