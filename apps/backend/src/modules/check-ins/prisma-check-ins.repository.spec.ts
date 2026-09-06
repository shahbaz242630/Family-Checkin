import { Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CheckInAlreadyScheduledError } from './check-ins.repository';
import { ATTEMPT_SCAN_LIMIT, CHECK_INS_RUN_LOCK_KEY, PrismaCheckInsRepository } from './prisma-check-ins.repository';
import type { CheckInsPrismaClient, LockTransactionClient } from './prisma-check-ins.repository';

function receiverMock() {
  return {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  };
}

function checkInMock() {
  return {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn(),
  };
}

function checkInAttemptMock() {
  return {
    createManyAndReturn: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
}

/** A `$transaction` whose lock query answers `acquired`; the callback gets the recording `$queryRaw`. */
function transactionMock(acquired: boolean) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ sql: strings.join('?'), values });
    return [{ acquired }];
  };
  const $transaction = vi.fn(async (fn: (tx: LockTransactionClient) => Promise<unknown>) =>
    fn({ $queryRaw } as LockTransactionClient),
  );
  return { $transaction, lock: $transaction as unknown as CheckInsPrismaClient['$transaction'], queries };
}

function attemptWithCheckInRow(overrides: Record<string, unknown> = {}) {
  return {
    ...attemptRow({
      status: CheckInAttemptStatus.PENDING,
      sentAt: null,
      providerMessageId: null,
      providerStatus: null,
    }),
    checkIn: {
      ...checkInRow(),
      receiver: {
        userId: 'sender-user-1',
        phoneEncrypted: 'encrypted-phone',
        countryCode: 'AE',
        language: 'en',
        nameEncrypted: 'encrypted-name',
        personalNoteEncrypted: null,
      },
    },
    ...overrides,
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
    scheduleInvalidAt: null,
    ...overrides,
  };
}

function checkInRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'check-in-1',
    receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
    scheduledLocalDate: new Date('2026-04-27T00:00:00.000Z'),
    retryOf: null,
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

/** The Los Angeles receiver from CB-013: a 16:00-18:00 local window is 23:00-01:00Z in summer. */
function losAngelesEvening(overrides: Record<string, unknown> = {}) {
  return receiverRow({
    id: 'receiver-la',
    timezone: 'America/Los_Angeles',
    scheduleTimeWindow: { start: '16:00', end: '18:00' },
    ...overrides,
  });
}

function localDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`receiverId`,`scheduledLocalDate`)'), {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PrismaCheckInsRepository', () => {
  it('returns granted, unpaused receivers whose schedule is due in their local timezone', async () => {
    const receiver = receiverMock();
    receiver.findMany.mockResolvedValue([receiverRow()]);
    const checkIn = checkInMock();
    const repository = new PrismaCheckInsRepository({
      $transaction: vi.fn(),
      receiver,
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

    expect(receiver.findMany).toHaveBeenCalledWith({
      where: {
        consentStatus: ConsentStatus.GRANTED,
        deletedAt: null,
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: new Date('2026-04-27T05:30:00.000Z') } }],
        scheduleFrequency: { in: ['daily'] },
      },
    });
    // The dedupe looks for a non-retry check-in on the receiver's own calendar day, not the UTC day (CB-013).
    expect(checkIn.findMany).toHaveBeenCalledWith({
      where: {
        retryOf: null,
        OR: [{ receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb', scheduledLocalDate: localDay('2026-04-27') }],
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
          scheduledLocalDate: '2026-04-27',
        },
      ],
      skipped: [],
      recovered: [],
    });
  });

  it('does not look up check-ins when no receiver is inside its window', async () => {
    const receiver = receiverMock();
    receiver.findMany.mockResolvedValue([receiverRow({ scheduleTimeWindow: { start: '18:00', end: '20:00' } })]);
    const checkIn = checkInMock();
    const repository = new PrismaCheckInsRepository({
      $transaction: vi.fn(),
      receiver,
      checkIn,
      checkInAttempt: checkInAttemptMock(),
    });

    const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

    expect(due).toEqual({ candidates: [], skipped: [], recovered: [] });
    expect(checkIn.findMany).not.toHaveBeenCalled();
  });

  it('skips rows whose timezone or schedule window cannot be evaluated and keeps every other receiver (CB-004)', async () => {
    const receiver = receiverMock();
    receiver.findMany.mockResolvedValue([
      receiverRow({ id: 'receiver-bad-timezone', timezone: 'Dubai' }),
      receiverRow({ id: 'receiver-bad-window', scheduleTimeWindow: { start: '9:00', end: '17:00' } }),
      receiverRow({ id: 'receiver-array-window', scheduleTimeWindow: [] }),
      receiverRow({ id: 'receiver-outside-window', scheduleTimeWindow: { start: '18:00', end: '20:00' } }),
      receiverRow({ id: 'receiver-good' }),
    ]);
    const repository = new PrismaCheckInsRepository({
      $transaction: vi.fn(),
      receiver,
      checkIn: checkInMock(),
      checkInAttempt: checkInAttemptMock(),
    });

    const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

    expect(due.candidates.map((candidate) => candidate.id)).toEqual(['receiver-good']);
    expect(due.skipped).toEqual([
      { receiverId: 'receiver-bad-timezone', userId: 'sender-user-1', reason: 'invalid_timezone' },
      { receiverId: 'receiver-bad-window', userId: 'sender-user-1', reason: 'invalid_schedule_time_window' },
      { receiverId: 'receiver-array-window', userId: 'sender-user-1', reason: 'invalid_schedule_time_window' },
    ]);
  });

  describe('dedupes on the receiver local day (CB-013)', () => {
    it('gives a Los Angeles evening window one check-in even though it straddles UTC midnight', async () => {
      const receiver = receiverMock();
      receiver.findMany.mockResolvedValue([losAngelesEvening()]);
      const checkIn = checkInMock();
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn,
        checkInAttempt: checkInAttemptMock(),
      });

      // 16:30 PDT on 5 September: nothing yet for that local day.
      const firstTick = await repository.findReceiversDueForCheckIn(new Date('2026-09-05T23:30:00.000Z'));
      expect(firstTick.candidates.map((candidate) => [candidate.id, candidate.scheduledLocalDate])).toEqual([
        ['receiver-la', '2026-09-05'],
      ]);

      // 17:10 PDT, still 5 September locally but already 6 September in UTC: the row from 16:30 blocks a second one.
      checkIn.findMany.mockResolvedValue([{ receiverId: 'receiver-la', scheduledLocalDate: localDay('2026-09-05') }]);
      const secondTick = await repository.findReceiversDueForCheckIn(new Date('2026-09-06T00:10:00.000Z'));

      expect(checkIn.findMany).toHaveBeenLastCalledWith({
        where: { retryOf: null, OR: [{ receiverId: 'receiver-la', scheduledLocalDate: localDay('2026-09-05') }] },
      });
      expect(secondTick.candidates).toEqual([]);
    });

    it('keeps one check-in per local day on the day daylight saving ends', async () => {
      const receiver = receiverMock();
      receiver.findMany.mockResolvedValue([losAngelesEvening()]);
      const checkIn = checkInMock();
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn,
        checkInAttempt: checkInAttemptMock(),
      });

      // 16:30 PST on 1 November (clocks went back at 02:00 that morning); yesterday's row is for 31 October.
      checkIn.findMany.mockResolvedValue([{ receiverId: 'receiver-la', scheduledLocalDate: localDay('2026-10-31') }]);
      const afternoon = await repository.findReceiversDueForCheckIn(new Date('2026-11-02T00:30:00.000Z'));
      expect(checkIn.findMany).toHaveBeenLastCalledWith({
        where: { retryOf: null, OR: [{ receiverId: 'receiver-la', scheduledLocalDate: localDay('2026-11-01') }] },
      });
      expect(afternoon.candidates.map((candidate) => candidate.scheduledLocalDate)).toEqual(['2026-11-01']);

      // 17:45 PST the same evening: the 1 November row now exists.
      checkIn.findMany.mockResolvedValue([{ receiverId: 'receiver-la', scheduledLocalDate: localDay('2026-11-01') }]);
      const evening = await repository.findReceiversDueForCheckIn(new Date('2026-11-02T01:45:00.000Z'));
      expect(evening.candidates).toEqual([]);
    });

    it('assigns the small hours of a window that wraps midnight to the day it opened', async () => {
      const receiver = receiverMock();
      receiver.findMany.mockResolvedValue([receiverRow({ scheduleTimeWindow: { start: '22:00', end: '06:00' } })]);
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });

      // 01:30 in Dubai on 27 April belongs to the window that opened at 22:00 on 26 April.
      const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-26T21:30:00.000Z'));

      expect(due.candidates.map((candidate) => candidate.scheduledLocalDate)).toEqual(['2026-04-26']);
    });

    it('ignores retry rows when deciding whether today is already covered', async () => {
      const receiver = receiverMock();
      receiver.findMany.mockResolvedValue([receiverRow()]);
      const checkIn = checkInMock();
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn,
        checkInAttempt: checkInAttemptMock(),
      });

      await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

      expect(checkIn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ retryOf: null }) }),
      );
    });

    it('stores the local day and the retried check-in on create, defaulting to the UTC day when none is given', async () => {
      const checkIn = checkInMock();
      checkIn.create
        .mockResolvedValueOnce(checkInRow({ status: CheckInStatus.PENDING, channelUsed: null, sentAt: null }))
        .mockResolvedValueOnce(
          checkInRow({
            id: 'check-in-retry',
            status: CheckInStatus.PENDING,
            channelUsed: null,
            sentAt: null,
            scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
            scheduledLocalDate: localDay('2026-04-27'),
            retryOf: 'check-in-1',
          }),
        );
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn,
        checkInAttempt: checkInAttemptMock(),
      });

      const scheduled = await repository.createPending({
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
        scheduledLocalDate: '2026-04-27',
      });
      const retry = await repository.createPending({
        receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
        retryOf: 'check-in-1',
      });

      expect(checkIn.create).toHaveBeenNthCalledWith(1, {
        data: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
          scheduledLocalDate: localDay('2026-04-27'),
          retryOf: null,
          status: CheckInStatus.PENDING,
        },
      });
      expect(checkIn.create).toHaveBeenNthCalledWith(2, {
        data: {
          receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          scheduledAt: new Date('2026-04-27T05:45:00.000Z'),
          scheduledLocalDate: localDay('2026-04-27'),
          retryOf: 'check-in-1',
          status: CheckInStatus.PENDING,
        },
      });
      expect(scheduled).toMatchObject({ id: 'check-in-1', scheduledLocalDate: '2026-04-27', retryOf: undefined });
      expect(retry).toMatchObject({ id: 'check-in-retry', scheduledLocalDate: '2026-04-27', retryOf: 'check-in-1' });
    });

    it('reports a unique-index rejection as CheckInAlreadyScheduledError and rethrows anything else', async () => {
      const checkIn = checkInMock();
      checkIn.create.mockRejectedValueOnce(uniqueViolation()).mockRejectedValueOnce(new Error('connection reset'));
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn,
        checkInAttempt: checkInAttemptMock(),
      });
      const input = {
        receiverId: 'receiver-la',
        scheduledAt: new Date('2026-09-06T00:10:00.000Z'),
        scheduledLocalDate: '2026-09-05',
      };

      await expect(repository.createPending(input)).rejects.toEqual(
        expect.objectContaining({
          name: 'CheckInAlreadyScheduledError',
          receiverId: 'receiver-la',
          scheduledLocalDate: '2026-09-05',
        }),
      );
      await expect(repository.createPending(input)).rejects.not.toBeInstanceOf(CheckInAlreadyScheduledError);
    });
  });

  describe('stamps an invalid schedule once per version (CB-069)', () => {
    it('marks the receiver only while the stamp is null and clears it in bulk', async () => {
      const receiver = receiverMock();
      receiver.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 2 });
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });
      const seenAt = new Date('2026-09-06T08:00:00.000Z');

      await expect(repository.markScheduleInvalid({ receiverId: 'receiver-dubai', seenAt })).resolves.toBe(true);
      await expect(repository.markScheduleInvalid({ receiverId: 'receiver-dubai', seenAt })).resolves.toBe(false);
      await expect(
        repository.clearScheduleInvalid({ receiverIds: ['receiver-dubai', 'receiver-fixed'] }),
      ).resolves.toBe(2);
      await expect(repository.clearScheduleInvalid({ receiverIds: [] })).resolves.toBe(0);

      expect(receiver.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'receiver-dubai', scheduleInvalidAt: null },
        data: { scheduleInvalidAt: seenAt },
      });
      expect(receiver.updateMany).toHaveBeenNthCalledWith(3, {
        where: { id: { in: ['receiver-dubai', 'receiver-fixed'] }, scheduleInvalidAt: { not: null } },
        data: { scheduleInvalidAt: null },
      });
      expect(receiver.updateMany).toHaveBeenCalledTimes(3);
    });

    it('reports stamped receivers whose schedule evaluates again, whether or not they are due', async () => {
      const receiver = receiverMock();
      receiver.findMany.mockResolvedValue([
        receiverRow({
          id: 'receiver-fixed-outside-window',
          scheduleInvalidAt: new Date('2026-09-05T08:00:00.000Z'),
          scheduleTimeWindow: { start: '18:00', end: '20:00' },
        }),
        receiverRow({ id: 'receiver-fixed-due', scheduleInvalidAt: new Date('2026-09-05T08:00:00.000Z') }),
        receiverRow({
          id: 'receiver-still-bad',
          scheduleInvalidAt: new Date('2026-09-05T08:00:00.000Z'),
          timezone: 'Dubai',
        }),
        receiverRow({ id: 'receiver-never-bad' }),
      ]);
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver,
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });

      const due = await repository.findReceiversDueForCheckIn(new Date('2026-04-27T05:30:00.000Z'));

      expect(due.recovered).toEqual(['receiver-fixed-outside-window', 'receiver-fixed-due']);
      expect(due.skipped).toEqual([
        { receiverId: 'receiver-still-bad', userId: 'sender-user-1', reason: 'invalid_timezone' },
      ]);
      expect(due.candidates.map((candidate) => candidate.id)).toEqual(['receiver-fixed-due', 'receiver-never-bad']);
      // Reporting is read-only; the service decides when to clear the stamp.
      expect(receiver.updateMany).not.toHaveBeenCalled();
    });
  });

  it('creates pending check-in records and marks them sent only while they are still open', async () => {
    const checkIn = checkInMock();
    checkIn.create.mockResolvedValue(checkInRow({ status: CheckInStatus.PENDING, channelUsed: null, sentAt: null }));
    checkIn.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaCheckInsRepository({
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
        scheduledLocalDate: localDay('2026-04-27'),
        retryOf: null,
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
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
    expect(open).toEqual([
      expect.objectContaining({ id: 'check-in-1', status: CheckInStatus.PENDING, scheduledLocalDate: '2026-04-27' }),
    ]);
  });

  it('times out, fails and skips attempts only from the status each transition expects', async () => {
    const checkInAttempt = checkInAttemptMock();
    checkInAttempt.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });
    const repository = new PrismaCheckInsRepository({
      $transaction: vi.fn(),
      receiver: receiverMock(),
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
      $transaction: vi.fn(),
      receiver: receiverMock(),
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

  describe('claims attempts and locks the tick (CB-045)', () => {
    it('claims a pending attempt as SENT with a sending status and no provider id, then records the provider result while it is still SENT', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });
      const sentAt = new Date('2026-04-27T05:30:00.000Z');

      await expect(
        repository.markAttemptSent({ attemptId: 'attempt-1', sentAt, providerStatus: 'sending' }),
      ).resolves.toBe(true);
      await expect(
        repository.markAttemptSent({ attemptId: 'attempt-1', sentAt, providerStatus: 'sending' }),
      ).resolves.toBe(false);
      await expect(
        repository.recordAttemptSendResult({
          attemptId: 'attempt-1',
          providerMessageId: 'SM-1',
          providerStatus: 'queued',
        }),
      ).resolves.toBe(true);

      expect(checkInAttempt.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'attempt-1', status: { in: [CheckInAttemptStatus.PENDING] } },
        data: { status: CheckInAttemptStatus.SENT, sentAt, providerStatus: 'sending' },
      });
      expect(checkInAttempt.updateMany).toHaveBeenNthCalledWith(3, {
        where: { id: 'attempt-1', status: { in: [CheckInAttemptStatus.SENT] } },
        data: { providerMessageId: 'SM-1', providerStatus: 'queued' },
      });
    });

    it('still writes the provider id on markAttemptSent when the caller already has it', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.updateMany.mockResolvedValue({ count: 1 });
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });
      const sentAt = new Date('2026-04-27T05:30:00.000Z');

      await repository.markAttemptSent({
        attemptId: 'attempt-1',
        sentAt,
        providerMessageId: 'SM-1',
        providerStatus: 'queued',
      });

      expect(checkInAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'attempt-1', status: { in: [CheckInAttemptStatus.PENDING] } },
        data: { status: CheckInAttemptStatus.SENT, sentAt, providerStatus: 'queued', providerMessageId: 'SM-1' },
      });
    });

    it('counts pending attempts in the database and bounds both attempt scans', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.count.mockResolvedValue(2);
      checkInAttempt.findMany.mockResolvedValue([]);
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });
      const now = new Date('2026-04-27T05:46:00.000Z');

      await expect(repository.countPendingAttempts({ checkInId: 'check-in-1' })).resolves.toBe(2);
      await repository.findDuePendingAttempts({ now });
      await repository.findTimedOutSentAttempts({ now });

      expect(checkInAttempt.count).toHaveBeenCalledWith({
        where: { checkInId: 'check-in-1', status: CheckInAttemptStatus.PENDING },
      });
      expect(ATTEMPT_SCAN_LIMIT).toBe(500);
      expect(checkInAttempt.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { status: CheckInAttemptStatus.PENDING, scheduledAt: { lte: now } },
          orderBy: [{ scheduledAt: 'asc' }, { attemptNumber: 'asc' }],
          take: ATTEMPT_SCAN_LIMIT,
        }),
      );
      expect(checkInAttempt.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { status: CheckInAttemptStatus.SENT, sentAt: { lte: now } },
          take: ATTEMPT_SCAN_LIMIT,
        }),
      );
    });

    it('fetches only the earliest due pending attempt of one check-in', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.findMany.mockResolvedValueOnce([attemptWithCheckInRow()]).mockResolvedValueOnce([]);
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });
      const now = new Date('2026-04-27T06:20:00.000Z');

      const next = await repository.findNextDuePendingAttempt({ checkInId: 'check-in-1', now });
      const none = await repository.findNextDuePendingAttempt({ checkInId: 'check-in-1', now });

      expect(next).toMatchObject({
        id: 'attempt-3',
        status: CheckInAttemptStatus.PENDING,
        checkIn: { id: 'check-in-1', receiverUserId: 'sender-user-1', receiverPhoneEncrypted: 'encrypted-phone' },
      });
      expect(none).toBeNull();
      expect(checkInAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { checkInId: 'check-in-1', status: CheckInAttemptStatus.PENDING, scheduledAt: { lte: now } },
          orderBy: [{ scheduledAt: 'asc' }, { attemptNumber: 'asc' }],
          take: 1,
        }),
      );
    });

    it('runs the tick inside a transaction that holds the advisory lock and returns the work result', async () => {
      const { $transaction, lock, queries } = transactionMock(true);
      const repository = new PrismaCheckInsRepository({
        $transaction: lock,
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });
      const work = vi.fn(async () => ({ sent: 3 }));

      await expect(repository.runExclusively(work, { timeoutMs: 300_000 })).resolves.toEqual({
        locked: false,
        result: { sent: 3 },
      });

      expect(work).toHaveBeenCalledTimes(1);
      expect($transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 300_000 });
      expect(queries).toEqual([
        {
          sql: expect.stringContaining('pg_try_advisory_xact_lock(?::int, ?::int)'),
          values: [...CHECK_INS_RUN_LOCK_KEY],
        },
      ]);
    });

    it('answers locked at once, without running the work, when another tick holds the lock', async () => {
      const { lock } = transactionMock(false);
      const repository = new PrismaCheckInsRepository({
        $transaction: lock,
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });
      const work = vi.fn(async () => ({ sent: 3 }));

      await expect(repository.runExclusively(work, { timeoutMs: 300_000 })).resolves.toEqual({ locked: true });
      expect(work).not.toHaveBeenCalled();
    });

    it('keeps the counts of a run that outlived its lock transaction and rethrows any other failure', async () => {
      const expired = Object.assign(new Error('Transaction already closed'), { code: 'P2028', clientVersion: 'test' });
      const $queryRaw = async () => [{ acquired: true }];
      const $transaction = vi.fn(async (fn: (tx: LockTransactionClient) => Promise<unknown>) => {
        await fn({ $queryRaw } as LockTransactionClient);
        throw expired;
      });
      const repository = new PrismaCheckInsRepository({
        $transaction: $transaction as unknown as CheckInsPrismaClient['$transaction'],
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });

      await expect(repository.runExclusively(async () => ({ sent: 1 }), { timeoutMs: 1 })).resolves.toEqual({
        locked: false,
        result: { sent: 1 },
      });
      await expect(
        repository.runExclusively(
          async () => {
            throw new Error('provider exploded');
          },
          { timeoutMs: 1 },
        ),
      ).rejects.toThrow('provider exploded');

      const beforeWork = vi.fn(async () => {
        throw expired;
      });
      const failing = new PrismaCheckInsRepository({
        $transaction: beforeWork as unknown as CheckInsPrismaClient['$transaction'],
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt: checkInAttemptMock(),
      });
      await expect(failing.runExclusively(async () => ({ sent: 1 }), { timeoutMs: 1 })).rejects.toThrow(
        'Transaction already closed',
      );
    });
  });

  describe('pulls the next attempt forward after a delivery failure (CB-016)', () => {
    const dueAt = new Date('2026-04-27T05:32:00.000Z');

    it('moves the earliest pending attempt to dueAt only while it is still pending and scheduled later', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.findFirst.mockResolvedValue(
        attemptRow({
          id: 'attempt-2',
          attemptNumber: 2,
          channel: Channel.SMS,
          status: CheckInAttemptStatus.PENDING,
          scheduledAt: new Date('2026-04-27T06:00:00.000Z'),
          sentAt: null,
          providerMessageId: null,
        }),
      );
      checkInAttempt.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });

      const moved = await repository.expediteNextPendingAttempt({ checkInId: 'check-in-1', dueAt });
      const raced = await repository.expediteNextPendingAttempt({ checkInId: 'check-in-1', dueAt });

      expect(checkInAttempt.findFirst).toHaveBeenCalledWith({
        where: { checkInId: 'check-in-1', status: CheckInAttemptStatus.PENDING },
        orderBy: { attemptNumber: 'asc' },
      });
      expect(checkInAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'attempt-2', status: { in: [CheckInAttemptStatus.PENDING] } },
        data: { scheduledAt: dueAt },
      });
      expect(moved).toBe(true);
      expect(raced).toBe(false);
    });

    it('leaves an attempt that is already due, or a check-in with nothing pending, untouched', async () => {
      const checkInAttempt = checkInAttemptMock();
      checkInAttempt.findFirst
        .mockResolvedValueOnce(
          attemptRow({
            id: 'attempt-2',
            status: CheckInAttemptStatus.PENDING,
            scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
          }),
        )
        .mockResolvedValueOnce(null);
      const repository = new PrismaCheckInsRepository({
        $transaction: vi.fn(),
        receiver: receiverMock(),
        checkIn: checkInMock(),
        checkInAttempt,
      });

      expect(await repository.expediteNextPendingAttempt({ checkInId: 'check-in-1', dueAt })).toBe(false);
      expect(await repository.expediteNextPendingAttempt({ checkInId: 'check-in-1', dueAt })).toBe(false);
      expect(checkInAttempt.updateMany).not.toHaveBeenCalled();
    });
  });
});
