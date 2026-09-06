import { Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaCheckInsRepository } from './prisma-check-ins.repository';

function checkInMock() {
  return {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  };
}

function checkInAttemptMock() {
  return {
    createManyAndReturn: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
}

function receiverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    userId: 'sender-user-1',
    phoneEncrypted: 'encrypted-phone',
    countryCode: 'AE',
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
    ...overrides,
  };
}

function checkInRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'check-in-1',
    receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
    status: CheckInStatus.SENT,
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
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-3',
    checkInId: 'check-in-1',
    attemptNumber: 3,
    channel: Channel.VOICE,
    status: CheckInAttemptStatus.SENT,
    scheduledAt: new Date('2026-04-27T06:15:00.000Z'),
    sentAt: new Date('2026-04-27T06:15:00.000Z'),
    completedAt: null,
    providerMessageId: 'CA-final',
    providerStatus: 'queued',
    failureReason: null,
    createdAt: new Date('2026-04-27T05:30:00.000Z'),
    updatedAt: new Date('2026-04-27T06:15:00.000Z'),
    ...overrides,
  };
}

describe('PrismaCheckInsRepository', () => {
  it('returns granted, unpaused receivers whose schedule is due in their local timezone', async () => {
    const findMany = vi.fn().mockResolvedValue([receiverRow()]);
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany,
      },
      checkIn: checkInMock(),
      checkInAttempt: checkInAttemptMock(),
    });

    const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

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
    expect(due).toEqual({
      candidates: [
        {
          id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          userId: 'sender-user-1',
          phoneEncrypted: 'encrypted-phone',
          countryCode: 'AE',
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
      ],
      skipped: [],
    });
  });

  it('skips rows whose timezone or schedule window cannot be evaluated and keeps every other receiver (CB-004)', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        receiverRow({ id: 'receiver-bad-timezone', timezone: 'Dubai' }),
        receiverRow({ id: 'receiver-bad-window', scheduleTimeWindow: { start: '9:00', end: '17:00' } }),
        receiverRow({ id: 'receiver-array-window', scheduleTimeWindow: [] }),
        receiverRow({ id: 'receiver-outside-window', scheduleTimeWindow: { start: '18:00', end: '20:00' } }),
        receiverRow({ id: 'receiver-good' }),
      ]);
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany,
      },
      checkIn: checkInMock(),
      checkInAttempt: checkInAttemptMock(),
    });

    const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

    expect(due.candidates.map((candidate) => candidate.id)).toEqual(['receiver-good']);
    expect(due.skipped).toEqual([
      { receiverId: 'receiver-bad-timezone', reason: 'invalid_timezone' },
      { receiverId: 'receiver-bad-window', reason: 'invalid_schedule_time_window' },
      { receiverId: 'receiver-array-window', reason: 'invalid_schedule_time_window' },
    ]);
  });

  it('creates pending check-in records and marks them sent only while they are still open', async () => {
    const checkIn = checkInMock();
    checkIn.create.mockResolvedValue(checkInRow({ status: CheckInStatus.PENDING, channelUsed: null, sentAt: null }));
    checkIn.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    await repository.createPending({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
    });
    const markSentInput = {
      checkInId: 'check-in-1',
      channel: Channel.WHATSAPP,
      sentAt: new Date('2026-04-27T05:31:00.000Z'),
      providerMessageId: 'provider-message-1',
      providerStatus: 'accepted',
    };

    await expect(repository.markSent(markSentInput)).resolves.toBe(true);
    await expect(repository.markSent(markSentInput)).resolves.toBe(false);

    expect(checkIn.create).toHaveBeenCalledWith({
      data: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        status: 'PENDING',
      },
    });
    expect(checkIn.updateMany).toHaveBeenCalledWith({
      where: { id: 'check-in-1', status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT] } },
      data: {
        status: 'SENT',
        channelUsed: Channel.WHATSAPP,
        sentAt: new Date('2026-04-27T05:31:00.000Z'),
      },
    });
  });

  it('finds the latest open check-in and marks it responded, returning null once it has closed', async () => {
    const checkIn = checkInMock();
    checkIn.findFirst.mockResolvedValueOnce(checkInRow()).mockResolvedValueOnce(
      checkInRow({
        status: CheckInStatus.RESPONDED_OK,
        respondedAt: new Date('2026-04-27T05:45:00.000Z'),
        responseTranscript: 'encrypted-transcript',
        responseDetectedAs: 'ok',
      }),
    );
    checkIn.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });
    const respondedInput = {
      checkInId: 'check-in-1',
      status: CheckInStatus.RESPONDED_OK,
      respondedAt: new Date('2026-04-27T05:45:00.000Z'),
      responseDetectedAs: 'ok' as const,
      responseTranscript: 'encrypted-transcript',
    };

    await repository.findLatestOpenForReceiver('1aef91f9-64c9-4548-baa5-d70b52386efb');
    const responded = await repository.markResponded(respondedInput);
    const late = await repository.markResponded(respondedInput);

    expect(checkIn.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION] },
      },
      orderBy: { scheduledAt: 'desc' },
    });
    expect(checkIn.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'check-in-1',
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION] },
      },
      data: {
        status: 'RESPONDED_OK',
        respondedAt: new Date('2026-04-27T05:45:00.000Z'),
        responseDetectedAs: 'ok',
        responseTranscript: 'encrypted-transcript',
      },
    });
    expect(responded).toMatchObject({ id: 'check-in-1', status: CheckInStatus.RESPONDED_OK, responseDetectedAs: 'ok' });
    expect(late).toBeNull();
    // The no-op write does not read the row back.
    expect(checkIn.findFirst).toHaveBeenCalledTimes(2);
  });

  it('finds latest actionable check-in and marks it resolved by backup contact from an actionable status only', async () => {
    const checkIn = checkInMock();
    checkIn.findFirst
      .mockResolvedValueOnce(
        checkInRow({ receiverId: 'receiver-1', status: CheckInStatus.ESCALATED, responseDetectedAs: 'help' }),
      )
      .mockResolvedValueOnce(
        checkInRow({
          receiverId: 'receiver-1',
          status: CheckInStatus.RESOLVED,
          responseDetectedAs: 'help',
          resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
        }),
      );
    checkIn.updateMany.mockResolvedValue({ count: 1 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    await repository.findLatestActionableForReceiver('receiver-1');
    const resolved = await repository.markResolvedByBackupContact({
      checkInId: 'check-in-1',
      resolvedAt: new Date('2026-04-27T06:30:00.000Z'),
    });

    expect(checkIn.findFirst).toHaveBeenNthCalledWith(1, {
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
    expect(checkIn.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'check-in-1',
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

  it('flags needs attention and cancels only from an open status (CB-006, CB-008)', async () => {
    const checkIn = checkInMock();
    checkIn.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    await expect(repository.markNeedsAttention({ checkInId: 'check-in-1' })).resolves.toBe(false);
    await expect(repository.markCancelled({ checkInId: 'check-in-1' })).resolves.toBe(true);

    expect(checkIn.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'check-in-1', status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT] } },
      data: { status: CheckInStatus.NEEDS_ATTENTION },
    });
    expect(checkIn.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'check-in-1', status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT] } },
      data: { status: CheckInStatus.SKIPPED },
    });
  });

  it('lists the open check-ins of a receiver oldest first', async () => {
    const checkIn = checkInMock();
    checkIn.findMany.mockResolvedValue([checkInRow({ status: CheckInStatus.PENDING })]);
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    const open = await repository.findOpenForReceiver('1aef91f9-64c9-4548-baa5-d70b52386efb');

    expect(checkIn.findMany).toHaveBeenCalledWith({
      where: {
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT] },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    expect(open).toEqual([expect.objectContaining({ id: 'check-in-1', status: CheckInStatus.PENDING })]);
  });

  it('times out, fails and skips attempts only from the status each transition expects', async () => {
    const checkInAttempt = checkInAttemptMock();
    checkInAttempt.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: checkInMock(),
      checkInAttempt,
    });

    await expect(
      repository.markAttemptTimedOut({ attemptId: 'attempt-1', completedAt: new Date('2026-04-27T05:46:00.000Z') }),
    ).resolves.toBe(true);
    await expect(
      repository.markAttemptFailed({
        attemptId: 'attempt-1',
        completedAt: new Date('2026-04-27T05:46:00.000Z'),
        failureReason: 'provider_send_failed',
      }),
    ).resolves.toBe(false);
    await expect(
      repository.skipPendingAttemptsForCheckIn({
        checkInId: 'check-in-1',
        completedAt: new Date('2026-04-27T05:46:00.000Z'),
        failureReason: 'receiver_opted_out',
      }),
    ).resolves.toBe(2);

    expect(checkInAttempt.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'attempt-1', status: { in: [CheckInAttemptStatus.SENT] } },
      data: {
        status: CheckInAttemptStatus.TIMED_OUT,
        completedAt: new Date('2026-04-27T05:46:00.000Z'),
        failureReason: 'response_window_elapsed',
      },
    });
    expect(checkInAttempt.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'attempt-1', status: { in: [CheckInAttemptStatus.PENDING, CheckInAttemptStatus.SENT] } },
      data: {
        status: CheckInAttemptStatus.FAILED,
        completedAt: new Date('2026-04-27T05:46:00.000Z'),
        failureReason: 'provider_send_failed',
      },
    });
    expect(checkInAttempt.updateMany).toHaveBeenNthCalledWith(3, {
      where: { checkInId: 'check-in-1', status: { in: [CheckInAttemptStatus.PENDING] } },
      data: {
        status: CheckInAttemptStatus.SKIPPED,
        completedAt: new Date('2026-04-27T05:46:00.000Z'),
        failureReason: 'receiver_opted_out',
      },
    });
  });

  it('records a provider failure on the latest sent attempt and returns null once that attempt is no longer sent', async () => {
    const checkInAttempt = checkInAttemptMock();
    checkInAttempt.findFirst.mockResolvedValue(attemptRow());
    checkInAttempt.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaCheckInsRepository({
      receiver: {
        findMany: vi.fn(),
      },
      checkIn: checkInMock(),
      checkInAttempt,
    });
    const input = {
      providerMessageId: 'CA-final',
      completedAt: new Date('2026-04-27T06:20:00.000Z'),
      providerStatus: 'no-answer',
      failureReason: 'twilio_status_no-answer',
    };

    const failed = await repository.markSentAttemptProviderFailure(input);
    const replayed = await repository.markSentAttemptProviderFailure(input);

    expect(checkInAttempt.findFirst).toHaveBeenCalledWith({
      where: { providerMessageId: 'CA-final', status: CheckInAttemptStatus.SENT },
      orderBy: { sentAt: 'desc' },
    });
    expect(checkInAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-3', status: { in: [CheckInAttemptStatus.SENT] } },
      data: {
        status: CheckInAttemptStatus.FAILED,
        completedAt: new Date('2026-04-27T06:20:00.000Z'),
        providerStatus: 'no-answer',
        failureReason: 'twilio_status_no-answer',
      },
    });
    expect(failed).toMatchObject({
      id: 'attempt-3',
      checkInId: 'check-in-1',
      status: CheckInAttemptStatus.FAILED,
      providerStatus: 'no-answer',
      failureReason: 'twilio_status_no-answer',
      completedAt: new Date('2026-04-27T06:20:00.000Z'),
    });
    expect(replayed).toBeNull();
  });
});
