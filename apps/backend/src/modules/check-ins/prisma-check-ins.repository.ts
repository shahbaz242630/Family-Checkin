import { Inject, Injectable } from '@nestjs/common';
import { CheckInAttemptStatus, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel, CheckIn, CheckInAttempt, Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  assertSupportedTimeZone,
  isInsideScheduleWindow,
  localClockInTimeZone,
  parseScheduleTimeWindow,
  ReceiverScheduleValidationError,
  scheduleDayOf,
} from '../../shared/schedule/receiver-schedule';
import type { ScheduleTimeWindow } from '../../shared/schedule/receiver-schedule';
import {
  CHECK_IN_ALLOWED_FROM,
  CHECK_IN_ATTEMPT_ALLOWED_FROM,
  CheckInAlreadyScheduledError,
  OPEN_CHECK_IN_STATUSES,
} from './check-ins.repository';
import type {
  CheckInAttemptRecord,
  CheckInAttemptWithCheckInRecord,
  CheckInReceiverCandidate,
  CheckInRecord,
  CheckInsRepository,
  CreateCheckInAttemptInput,
  CreatePendingCheckInInput,
  MarkCheckInAttemptFailedInput,
  MarkCheckInAttemptSentInput,
  MarkCheckInAttemptTimedOutInput,
  MarkCheckInRespondedInput,
  MarkCheckInSentInput,
  MarkSentCheckInAttemptProviderFailureInput,
  ReceiversDueForCheckIn,
  SkipPendingCheckInAttemptsInput,
} from './check-ins.repository';

type ReceiverDueForCheckIn = Pick<
  Receiver,
  | 'id'
  | 'userId'
  | 'nameEncrypted'
  | 'phoneEncrypted'
  | 'personalNoteEncrypted'
  | 'countryCode'
  | 'language'
  | 'timezone'
  | 'techProfile'
  | 'primaryChannel'
  | 'fallbackChannels'
  | 'scheduleFrequency'
  | 'scheduleTimeWindow'
  | 'consentStatus'
  | 'pausedUntil'
  | 'deletedAt'
  | 'scheduleInvalidAt'
>;

type AttemptWithCheckIn = CheckInAttempt & {
  checkIn: CheckIn & {
    receiver: {
      userId: string;
      phoneEncrypted: string;
      countryCode: string;
      language: string;
      nameEncrypted: string;
      personalNoteEncrypted: string | null;
    };
  };
};

interface CheckInsPrismaClient {
  receiver: {
    findMany(args: {
      where: {
        consentStatus: ConsentStatus;
        deletedAt: null;
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: Date } }];
        scheduleFrequency: { in: string[] };
      };
    }): Promise<ReceiverDueForCheckIn[]>;
    updateMany(args: {
      where: { id: string; scheduleInvalidAt: null } | { id: { in: string[] }; scheduleInvalidAt: { not: null } };
      data: { scheduleInvalidAt: Date | null };
    }): Promise<{ count: number }>;
  };
  checkIn: {
    create(args: {
      data: {
        receiverId: string;
        scheduledAt: Date;
        scheduledLocalDate: Date;
        retryOf: string | null;
        status: CheckInStatus;
      };
    }): Promise<CheckIn>;
    findFirst(
      args:
        | {
            where: {
              id: string;
            };
          }
        | {
            where: {
              receiverId: string;
              status: { in: CheckInStatus[] };
            };
            orderBy: { scheduledAt: 'desc' };
          },
    ): Promise<CheckIn | null>;
    findMany(
      args:
        | {
            where: {
              receiverId: string;
              status: { in: CheckInStatus[] };
            };
            orderBy: { scheduledAt: 'asc' };
          }
        | {
            where: {
              retryOf: null;
              OR: Array<{ receiverId: string; scheduledLocalDate: Date }>;
            };
          },
    ): Promise<CheckIn[]>;
    updateMany(args: {
      where: { id: string; status: { in: CheckInStatus[] } };
      data: Partial<{
        status: CheckInStatus;
        channelUsed: Channel;
        sentAt: Date;
        respondedAt: Date;
        responseDetectedAs: string;
        responseTranscript: string;
        resolvedAt: Date;
      }>;
    }): Promise<{ count: number }>;
  };
  checkInAttempt: {
    createManyAndReturn(args: { data: CreateCheckInAttemptInput[] }): Promise<CheckInAttempt[]>;
    findMany(args: {
      where: {
        status: CheckInAttemptStatus;
        scheduledAt?: { lte: Date };
        sentAt?: { lte: Date };
      };
      include: {
        checkIn: {
          include: {
            receiver: {
              select: {
                userId: true;
                phoneEncrypted: true;
                countryCode: true;
                language: true;
                nameEncrypted: true;
                personalNoteEncrypted: true;
              };
            };
          };
        };
      };
      orderBy: Array<{ scheduledAt?: 'asc' } | { attemptNumber?: 'asc' }>;
    }): Promise<AttemptWithCheckIn[]>;
    findFirst(args: {
      where:
        | { checkInId: string; status: CheckInAttemptStatus }
        | { providerMessageId: string; status: CheckInAttemptStatus };
      orderBy: { attemptNumber: 'desc' } | { attemptNumber: 'asc' } | { sentAt: 'desc' };
    }): Promise<CheckInAttempt | null>;
    updateMany(args: {
      where:
        | { id: string; status: { in: CheckInAttemptStatus[] } }
        | { checkInId: string; status: { in: CheckInAttemptStatus[] } };
      data: Partial<{
        status: CheckInAttemptStatus;
        scheduledAt: Date;
        sentAt: Date;
        completedAt: Date;
        providerMessageId: string;
        providerStatus: string;
        failureReason: string;
      }>;
    }): Promise<{ count: number }>;
  };
}

/** A receiver whose window is open right now, with the local day the new check-in will belong to. */
interface DueReceiver {
  receiver: ReceiverDueForCheckIn;
  window: ScheduleTimeWindow;
  scheduledLocalDate: string;
}

/** Prisma's error code for a unique-constraint violation, checked structurally so a mock can raise it too. */
const UNIQUE_VIOLATION_CODE = 'P2002';

@Injectable()
export class PrismaCheckInsRepository implements CheckInsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: CheckInsPrismaClient | PrismaService) {}

  async findReceiversDueForCheckIn(now: Date): Promise<ReceiversDueForCheckIn> {
    const receivers = await this.prisma.receiver.findMany({
      where: {
        consentStatus: ConsentStatus.GRANTED,
        deletedAt: null,
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
        scheduleFrequency: { in: ['daily'] },
      },
    });
    const result: Required<ReceiversDueForCheckIn> = { candidates: [], skipped: [], recovered: [] };
    const due: DueReceiver[] = [];

    for (const receiver of receivers) {
      let window: ScheduleTimeWindow;
      let clock: ReturnType<typeof localClockInTimeZone>;
      try {
        window = parseScheduleTimeWindow(receiver.scheduleTimeWindow);
        assertSupportedTimeZone(receiver.timezone);
        clock = localClockInTimeZone(now, receiver.timezone);
      } catch (error) {
        // One row saved as `timezone: 'Dubai'` or `{ start: '9:00' }` used to reject the whole query and stall
        // every receiver's check-in (CB-004). Report the row and carry on; the service audits it.
        result.skipped.push({
          receiverId: receiver.id,
          userId: receiver.userId,
          reason: this.scheduleInvalidReason(error),
        });
        continue;
      }

      if (receiver.scheduleInvalidAt) {
        result.recovered.push(receiver.id);
      }
      if (isInsideScheduleWindow(window, clock.minutes)) {
        due.push({ receiver, window, scheduledLocalDate: scheduleDayOf(clock, window) });
      }
    }

    // The daily dedupe: one non-retry check-in per receiver per *local* day (CB-013). The day differs per
    // receiver, so it cannot be a constant in the receivers query; one batched lookup covers every due receiver.
    const alreadyScheduled = await this.findScheduledLocalDays(due);
    for (const entry of due) {
      if (alreadyScheduled.has(this.localDayKey(entry.receiver.id, entry.scheduledLocalDate))) {
        continue;
      }
      result.candidates.push(this.toCandidate(entry));
    }

    return result;
  }

  async markScheduleInvalid(input: { receiverId: string; seenAt: Date }): Promise<boolean> {
    const result = await this.prisma.receiver.updateMany({
      where: { id: input.receiverId, scheduleInvalidAt: null },
      data: { scheduleInvalidAt: input.seenAt },
    });

    return result.count > 0;
  }

  async clearScheduleInvalid(input: { receiverIds: string[] }): Promise<number> {
    if (input.receiverIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.receiver.updateMany({
      where: { id: { in: input.receiverIds }, scheduleInvalidAt: { not: null } },
      data: { scheduleInvalidAt: null },
    });

    return result.count;
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    const scheduledLocalDate = input.scheduledLocalDate ?? this.utcCalendarDay(input.scheduledAt);
    let checkIn: CheckIn;
    try {
      checkIn = await this.prisma.checkIn.create({
        data: {
          receiverId: input.receiverId,
          scheduledAt: input.scheduledAt,
          scheduledLocalDate: this.toDateColumn(scheduledLocalDate),
          retryOf: input.retryOf ?? null,
          status: CheckInStatus.PENDING,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        // The partial unique index on (receiverId, scheduledLocalDate) WHERE retryOf IS NULL fired: an
        // overlapping tick created today's check-in between our lookup and this insert (CB-013, CB-045).
        throw new CheckInAlreadyScheduledError(input.receiverId, scheduledLocalDate);
      }
      throw error;
    }

    return this.toCheckInRecord(checkIn);
  }

  async createAttempts(input: CreateCheckInAttemptInput[]): Promise<CheckInAttemptRecord[]> {
    if (input.length === 0) {
      return [];
    }

    const attempts = await this.prisma.checkInAttempt.createManyAndReturn({
      data: input,
    });

    return attempts
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => this.toCheckInAttemptRecord(attempt));
  }

  async markSent(input: MarkCheckInSentInput): Promise<boolean> {
    return this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.sent, {
      status: CheckInStatus.SENT,
      channelUsed: input.channel,
      sentAt: input.sentAt,
    });
  }

  async findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]> {
    const attempts = await this.prisma.checkInAttempt.findMany({
      where: {
        status: CheckInAttemptStatus.PENDING,
        scheduledAt: { lte: input.now },
      },
      include: {
        checkIn: {
          include: {
            receiver: {
              select: {
                userId: true,
                phoneEncrypted: true,
                countryCode: true,
                language: true,
                nameEncrypted: true,
                personalNoteEncrypted: true,
              },
            },
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { attemptNumber: 'asc' }],
    });

    return attempts.map((attempt) => this.toAttemptWithCheckInRecord(attempt));
  }

  async findTimedOutSentAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]> {
    const attempts = await this.prisma.checkInAttempt.findMany({
      where: {
        status: CheckInAttemptStatus.SENT,
        sentAt: { lte: input.now },
      },
      include: {
        checkIn: {
          include: {
            receiver: {
              select: {
                userId: true,
                phoneEncrypted: true,
                countryCode: true,
                language: true,
                nameEncrypted: true,
                personalNoteEncrypted: true,
              },
            },
          },
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { attemptNumber: 'asc' }],
    });

    return attempts.map((attempt) => this.toAttemptWithCheckInRecord(attempt));
  }

  async markAttemptSent(input: MarkCheckInAttemptSentInput): Promise<boolean> {
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.sent, {
      status: CheckInAttemptStatus.SENT,
      sentAt: input.sentAt,
      providerMessageId: input.providerMessageId,
      providerStatus: input.providerStatus,
    });
  }

  async markAttemptFailed(input: MarkCheckInAttemptFailedInput): Promise<boolean> {
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.failed, {
      status: CheckInAttemptStatus.FAILED,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
    });
  }

  async markSentAttemptProviderFailure(
    input: MarkSentCheckInAttemptProviderFailureInput,
  ): Promise<CheckInAttemptRecord | null> {
    const latest = await this.prisma.checkInAttempt.findFirst({
      where: {
        providerMessageId: input.providerMessageId,
        status: CheckInAttemptStatus.SENT,
      },
      orderBy: { sentAt: 'desc' },
    });
    if (!latest) {
      return null;
    }

    const data = {
      status: CheckInAttemptStatus.FAILED,
      completedAt: input.completedAt,
      providerStatus: input.providerStatus,
      failureReason: input.failureReason,
    };
    if (!(await this.transitionAttempt(latest.id, CHECK_IN_ATTEMPT_ALLOWED_FROM.providerFailure, data))) {
      return null;
    }

    return this.toCheckInAttemptRecord({ ...latest, ...data });
  }

  async markAttemptTimedOut(input: MarkCheckInAttemptTimedOutInput): Promise<boolean> {
    return this.transitionAttempt(input.attemptId, CHECK_IN_ATTEMPT_ALLOWED_FROM.timedOut, {
      status: CheckInAttemptStatus.TIMED_OUT,
      completedAt: input.completedAt,
      failureReason: 'response_window_elapsed',
    });
  }

  async expediteNextPendingAttempt(input: { checkInId: string; dueAt: Date }): Promise<boolean> {
    const next = await this.prisma.checkInAttempt.findFirst({
      where: { checkInId: input.checkInId, status: CheckInAttemptStatus.PENDING },
      orderBy: { attemptNumber: 'asc' },
    });
    if (!next || next.scheduledAt.getTime() <= input.dueAt.getTime()) {
      return false;
    }

    // Guarded like every other attempt write: a tick that sent or skipped it in the meantime wins.
    return this.transitionAttempt(next.id, [CheckInAttemptStatus.PENDING], { scheduledAt: input.dueAt });
  }

  async markLatestSentAttemptResponded(input: {
    checkInId: string;
    completedAt: Date;
  }): Promise<CheckInAttemptRecord | null> {
    const latest = await this.prisma.checkInAttempt.findFirst({
      where: { checkInId: input.checkInId, status: CheckInAttemptStatus.SENT },
      orderBy: { attemptNumber: 'desc' },
    });
    if (!latest) {
      return null;
    }

    const data = {
      status: CheckInAttemptStatus.RESPONDED,
      completedAt: input.completedAt,
    };
    if (!(await this.transitionAttempt(latest.id, CHECK_IN_ATTEMPT_ALLOWED_FROM.responded, data))) {
      return null;
    }

    return this.toCheckInAttemptRecord({ ...latest, ...data });
  }

  async skipPendingAttemptsForCheckIn(input: SkipPendingCheckInAttemptsInput): Promise<number> {
    const result = await this.prisma.checkInAttempt.updateMany({
      where: { checkInId: input.checkInId, status: { in: [...CHECK_IN_ATTEMPT_ALLOWED_FROM.skipped] } },
      data: {
        status: CheckInAttemptStatus.SKIPPED,
        completedAt: input.completedAt,
        failureReason: input.failureReason,
      },
    });

    return result.count;
  }

  async markNeedsAttention(input: { checkInId: string }): Promise<boolean> {
    return this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.needsAttention, {
      status: CheckInStatus.NEEDS_ATTENTION,
    });
  }

  async markCancelled(input: { checkInId: string }): Promise<boolean> {
    return this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.cancelled, {
      status: CheckInStatus.SKIPPED,
    });
  }

  async findById(checkInId: string): Promise<CheckInRecord | null> {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        id: checkInId,
      },
    });

    return checkIn ? this.toCheckInRecord(checkIn) : null;
  }

  async findOpenForReceiver(receiverId: string): Promise<CheckInRecord[]> {
    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        receiverId,
        status: { in: [...OPEN_CHECK_IN_STATUSES] },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return checkIns.map((checkIn) => this.toCheckInRecord(checkIn));
  }

  async findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        receiverId,
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION] },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    return checkIn ? this.toCheckInRecord(checkIn) : null;
  }

  async findLatestActionableForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        receiverId,
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

    return checkIn ? this.toCheckInRecord(checkIn) : null;
  }

  async markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord | null> {
    const transitioned = await this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.responded, {
      status: input.status,
      respondedAt: input.respondedAt,
      responseDetectedAs: input.responseDetectedAs,
      responseTranscript: input.responseTranscript,
    });

    return transitioned ? this.findById(input.checkInId) : null;
  }

  async markResolvedByBackupContact(input: { checkInId: string; resolvedAt: Date }): Promise<CheckInRecord | null> {
    const transitioned = await this.transitionCheckIn(input.checkInId, CHECK_IN_ALLOWED_FROM.resolvedByBackupContact, {
      status: CheckInStatus.RESOLVED,
      resolvedAt: input.resolvedAt,
    });

    return transitioned ? this.findById(input.checkInId) : null;
  }

  private async transitionCheckIn(
    checkInId: string,
    allowedFrom: readonly CheckInStatus[],
    data: Parameters<CheckInsPrismaClient['checkIn']['updateMany']>[0]['data'],
  ): Promise<boolean> {
    const result = await this.prisma.checkIn.updateMany({
      where: { id: checkInId, status: { in: [...allowedFrom] } },
      data,
    });

    return result.count > 0;
  }

  private async transitionAttempt(
    attemptId: string,
    allowedFrom: readonly CheckInAttemptStatus[],
    data: Parameters<CheckInsPrismaClient['checkInAttempt']['updateMany']>[0]['data'],
  ): Promise<boolean> {
    const result = await this.prisma.checkInAttempt.updateMany({
      where: { id: attemptId, status: { in: [...allowedFrom] } },
      data,
    });

    return result.count > 0;
  }

  /** `receiverId|YYYY-MM-DD` keys of the non-retry check-ins that already exist for the due receivers' local days. */
  private async findScheduledLocalDays(due: DueReceiver[]): Promise<Set<string>> {
    if (due.length === 0) {
      return new Set();
    }

    const existing = await this.prisma.checkIn.findMany({
      where: {
        retryOf: null,
        OR: due.map((entry) => ({
          receiverId: entry.receiver.id,
          scheduledLocalDate: this.toDateColumn(entry.scheduledLocalDate),
        })),
      },
    });

    return new Set(
      existing.map((checkIn) => this.localDayKey(checkIn.receiverId, this.fromDateColumn(checkIn.scheduledLocalDate))),
    );
  }

  private localDayKey(receiverId: string, scheduledLocalDate: string): string {
    return `${receiverId}|${scheduledLocalDate}`;
  }

  /** A `DATE` column travels through Prisma as a `Date` at UTC midnight. */
  private toDateColumn(localDate: string): Date {
    return new Date(`${localDate}T00:00:00.000Z`);
  }

  private fromDateColumn(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private utcCalendarDay(instant: Date): string {
    return instant.toISOString().slice(0, 10);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
    );
  }

  private scheduleInvalidReason(error: unknown): string {
    return error instanceof ReceiverScheduleValidationError ? error.code.toLowerCase() : 'schedule_evaluation_failed';
  }

  private toCandidate(entry: DueReceiver): CheckInReceiverCandidate {
    const { receiver, window } = entry;
    return {
      id: receiver.id,
      userId: receiver.userId,
      nameEncrypted: receiver.nameEncrypted,
      phoneEncrypted: receiver.phoneEncrypted,
      personalNoteEncrypted: receiver.personalNoteEncrypted ?? undefined,
      countryCode: receiver.countryCode,
      language: receiver.language,
      timezone: receiver.timezone,
      techProfile: receiver.techProfile,
      primaryChannel: receiver.primaryChannel,
      fallbackChannels: receiver.fallbackChannels,
      scheduleFrequency: receiver.scheduleFrequency,
      scheduleTimeWindow: { start: window.start, end: window.end },
      consentStatus: receiver.consentStatus,
      pausedUntil: receiver.pausedUntil ?? undefined,
      deletedAt: receiver.deletedAt ?? undefined,
      scheduledLocalDate: entry.scheduledLocalDate,
    };
  }

  private toCheckInRecord(checkIn: CheckIn): CheckInRecord {
    return {
      id: checkIn.id,
      receiverId: checkIn.receiverId,
      scheduledAt: checkIn.scheduledAt,
      scheduledLocalDate: this.fromDateColumn(checkIn.scheduledLocalDate),
      retryOf: checkIn.retryOf ?? undefined,
      status: checkIn.status,
      channelUsed: checkIn.channelUsed ?? undefined,
      sentAt: checkIn.sentAt ?? undefined,
      respondedAt: checkIn.respondedAt ?? undefined,
      responseTranscript: checkIn.responseTranscript ?? undefined,
      responseDetectedAs: checkIn.responseDetectedAs ?? undefined,
      resolvedAt: checkIn.resolvedAt ?? undefined,
      resolutionNote: checkIn.resolutionNote ?? undefined,
      resolutionByUserId: checkIn.resolutionByUserId ?? undefined,
      createdAt: checkIn.createdAt,
      updatedAt: checkIn.updatedAt,
    };
  }

  private toCheckInAttemptRecord(attempt: CheckInAttempt): CheckInAttemptRecord {
    return {
      id: attempt.id,
      checkInId: attempt.checkInId,
      attemptNumber: attempt.attemptNumber,
      channel: attempt.channel,
      status: attempt.status,
      scheduledAt: attempt.scheduledAt,
      sentAt: attempt.sentAt ?? undefined,
      completedAt: attempt.completedAt ?? undefined,
      providerMessageId: attempt.providerMessageId ?? undefined,
      providerStatus: attempt.providerStatus ?? undefined,
      failureReason: attempt.failureReason ?? undefined,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    };
  }

  private toAttemptWithCheckInRecord(attempt: AttemptWithCheckIn): CheckInAttemptWithCheckInRecord {
    return {
      ...this.toCheckInAttemptRecord(attempt),
      checkIn: {
        ...this.toCheckInRecord(attempt.checkIn),
        receiverPhoneEncrypted: attempt.checkIn.receiver.phoneEncrypted,
        receiverCountryCode: attempt.checkIn.receiver.countryCode,
        receiverLanguage: attempt.checkIn.receiver.language,
        receiverNameEncrypted: attempt.checkIn.receiver.nameEncrypted,
        receiverPersonalNoteEncrypted: attempt.checkIn.receiver.personalNoteEncrypted ?? undefined,
        receiverUserId: attempt.checkIn.receiver.userId,
      },
    };
  }
}
