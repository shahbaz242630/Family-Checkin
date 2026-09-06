import { Inject, Injectable } from '@nestjs/common';
import { CheckInAttemptStatus, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel, CheckIn, CheckInAttempt, Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  assertSupportedTimeZone,
  parseScheduleTimeWindow,
  ReceiverScheduleValidationError,
  timeOfDayToMinutes,
} from '../../shared/schedule/receiver-schedule';
import type { ScheduleTimeWindow } from '../../shared/schedule/receiver-schedule';
import { CHECK_IN_ALLOWED_FROM, CHECK_IN_ATTEMPT_ALLOWED_FROM, OPEN_CHECK_IN_STATUSES } from './check-ins.repository';
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
>;

type AttemptWithCheckIn = CheckInAttempt & {
  checkIn: CheckIn & {
    receiver: {
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
        NOT: {
          checkIns: {
            some: {
              scheduledAt: {
                gte: Date;
                lt: Date;
              };
            };
          };
        };
      };
    }): Promise<ReceiverDueForCheckIn[]>;
  };
  checkIn: {
    create(args: { data: { receiverId: string; scheduledAt: Date; status: CheckInStatus } }): Promise<CheckIn>;
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
    findMany(args: {
      where: {
        receiverId: string;
        status: { in: CheckInStatus[] };
      };
      orderBy: { scheduledAt: 'asc' };
    }): Promise<CheckIn[]>;
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
      orderBy: { attemptNumber: 'desc' } | { sentAt: 'desc' };
    }): Promise<CheckInAttempt | null>;
    updateMany(args: {
      where:
        | { id: string; status: { in: CheckInAttemptStatus[] } }
        | { checkInId: string; status: { in: CheckInAttemptStatus[] } };
      data: Partial<{
        status: CheckInAttemptStatus;
        sentAt: Date;
        completedAt: Date;
        providerMessageId: string;
        providerStatus: string;
        failureReason: string;
      }>;
    }): Promise<{ count: number }>;
  };
}

@Injectable()
export class PrismaCheckInsRepository implements CheckInsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: CheckInsPrismaClient | PrismaService) {}

  async findReceiversDueForCheckIn(now: Date): Promise<ReceiversDueForCheckIn> {
    const { startOfDay, startOfNextDay } = this.utcDayBounds(now);
    const receivers = await this.prisma.receiver.findMany({
      where: {
        consentStatus: ConsentStatus.GRANTED,
        deletedAt: null,
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
        scheduleFrequency: { in: ['daily'] },
        NOT: {
          checkIns: {
            some: {
              scheduledAt: {
                gte: startOfDay,
                lt: startOfNextDay,
              },
            },
          },
        },
      },
    });
    const result: ReceiversDueForCheckIn = { candidates: [], skipped: [] };

    for (const receiver of receivers) {
      let window: ScheduleTimeWindow;
      let due: boolean;
      try {
        window = parseScheduleTimeWindow(receiver.scheduleTimeWindow);
        assertSupportedTimeZone(receiver.timezone);
        due = this.isInsideScheduleWindow(window, now, receiver.timezone);
      } catch (error) {
        // One row saved as `timezone: 'Dubai'` or `{ start: '9:00' }` used to reject the whole query and stall
        // every receiver's check-in (CB-004). Report the row and carry on; the service audits it.
        result.skipped.push({ receiverId: receiver.id, reason: this.scheduleInvalidReason(error) });
        continue;
      }

      if (due) {
        result.candidates.push(this.toCandidate(receiver, window));
      }
    }

    return result;
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    const checkIn = await this.prisma.checkIn.create({
      data: {
        receiverId: input.receiverId,
        scheduledAt: input.scheduledAt,
        status: CheckInStatus.PENDING,
      },
    });

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

  private isInsideScheduleWindow(window: ScheduleTimeWindow, now: Date, timezone: string): boolean {
    const currentMinutes = this.localTimeToMinutes(now, timezone);
    const startMinutes = timeOfDayToMinutes(window.start);
    const endMinutes = timeOfDayToMinutes(window.end);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  private localTimeToMinutes(now: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      throw new Error(`Could not resolve local time for timezone ${timezone}`);
    }

    return hour * 60 + minute;
  }

  private scheduleInvalidReason(error: unknown): string {
    return error instanceof ReceiverScheduleValidationError ? error.code.toLowerCase() : 'schedule_evaluation_failed';
  }

  private utcDayBounds(now: Date): { startOfDay: Date; startOfNextDay: Date } {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfNextDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return { startOfDay, startOfNextDay };
  }

  private toCandidate(receiver: ReceiverDueForCheckIn, window: ScheduleTimeWindow): CheckInReceiverCandidate {
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
    };
  }

  private toCheckInRecord(checkIn: CheckIn): CheckInRecord {
    return {
      id: checkIn.id,
      receiverId: checkIn.receiverId,
      scheduledAt: checkIn.scheduledAt,
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
      },
    };
  }
}
