import { Inject, Injectable } from '@nestjs/common';
import { CheckInAttemptStatus, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel, CheckIn, CheckInAttempt, Prisma, Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CheckInAttemptRecord,
  CheckInAttemptWithCheckInRecord,
  CheckInReceiverCandidate,
  CheckInRecord,
  CheckInsRepository,
  CreateCheckInAttemptInput,
  CreatePendingCheckInInput,
  FindOverdueSentCheckInsInput,
  MarkCheckInAttemptFailedInput,
  MarkCheckInAttemptSentInput,
  MarkCheckInAttemptTimedOutInput,
  MarkCheckInRespondedInput,
  MarkCheckInSentInput,
  SkipPendingCheckInAttemptsInput,
} from './check-ins.repository';

type ReceiverDueForCheckIn = Pick<
  Receiver,
  | 'id'
  | 'phoneEncrypted'
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
    findFirst(args: {
      where: {
        receiverId: string;
        status: { in: CheckInStatus[] };
      };
      orderBy: { scheduledAt: 'desc' };
    }): Promise<CheckIn | null>;
    findMany(args: {
      where: {
        status: CheckInStatus;
        sentAt: { lte: Date };
      };
      orderBy: { sentAt: 'asc' };
    }): Promise<CheckIn[]>;
    update(args: {
      where: { id: string };
      data: Partial<{
        status: CheckInStatus;
        channelUsed: Channel;
        sentAt: Date;
        respondedAt: Date;
        responseDetectedAs: string;
        responseTranscript: string;
        resolvedAt: Date;
      }>;
    }): Promise<CheckIn>;
  };
  checkInAttempt: {
    createManyAndReturn(args: { data: CreateCheckInAttemptInput[] }): Promise<CheckInAttempt[]>;
    findMany(args: {
      where: {
        status: CheckInAttemptStatus;
        scheduledAt?: { lte: Date };
        sentAt?: { lte: Date };
      };
      include: { checkIn: { include: { receiver: { select: { phoneEncrypted: true; language: true } } } } };
      orderBy: Array<{ scheduledAt?: 'asc' } | { attemptNumber?: 'asc' }>;
    }): Promise<Array<CheckInAttempt & { checkIn: CheckIn & { receiver: { phoneEncrypted: string; language: string } } }>>;
    findFirst(args: {
      where: { checkInId: string; status: CheckInAttemptStatus };
      orderBy: { attemptNumber: 'desc' };
    }): Promise<CheckInAttempt | null>;
    update(args: {
      where: { id: string };
      data: Partial<{
        status: CheckInAttemptStatus;
        sentAt: Date;
        completedAt: Date;
        providerMessageId: string;
        providerStatus: string;
        failureReason: string;
      }>;
    }): Promise<CheckInAttempt>;
    updateMany(args: {
      where: { checkInId: string; status: CheckInAttemptStatus };
      data: { status: CheckInAttemptStatus; completedAt: Date; failureReason: string };
    }): Promise<{ count: number }>;
  };
}

@Injectable()
export class PrismaCheckInsRepository implements CheckInsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: CheckInsPrismaClient | PrismaService) {}

  async findReceiversDueForCheckIn(now: Date): Promise<CheckInReceiverCandidate[]> {
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

    return receivers.filter((receiver) => this.isInsideScheduleWindow(receiver.scheduleTimeWindow, now, receiver.timezone)).map((receiver) => ({
      id: receiver.id,
      phoneEncrypted: receiver.phoneEncrypted,
      language: receiver.language,
      timezone: receiver.timezone,
      techProfile: receiver.techProfile,
      primaryChannel: receiver.primaryChannel,
      fallbackChannels: receiver.fallbackChannels,
      scheduleFrequency: receiver.scheduleFrequency,
      scheduleTimeWindow: this.toScheduleTimeWindow(receiver.scheduleTimeWindow),
      consentStatus: receiver.consentStatus,
      pausedUntil: receiver.pausedUntil ?? undefined,
      deletedAt: receiver.deletedAt ?? undefined,
    }));
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

  async markSent(input: MarkCheckInSentInput): Promise<CheckInRecord> {
    const checkIn = await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: {
        status: CheckInStatus.SENT,
        channelUsed: input.channel,
        sentAt: input.sentAt,
      },
    });

    return this.toCheckInRecord(checkIn);
  }

  async findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]> {
    const attempts = await this.prisma.checkInAttempt.findMany({
      where: {
        status: CheckInAttemptStatus.PENDING,
        scheduledAt: { lte: input.now },
      },
      include: { checkIn: { include: { receiver: { select: { phoneEncrypted: true, language: true } } } } },
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
      include: { checkIn: { include: { receiver: { select: { phoneEncrypted: true, language: true } } } } },
      orderBy: [{ scheduledAt: 'asc' }, { attemptNumber: 'asc' }],
    });

    return attempts.map((attempt) => this.toAttemptWithCheckInRecord(attempt));
  }

  async markAttemptSent(input: MarkCheckInAttemptSentInput): Promise<CheckInAttemptRecord> {
    const attempt = await this.prisma.checkInAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: CheckInAttemptStatus.SENT,
        sentAt: input.sentAt,
        providerMessageId: input.providerMessageId,
        providerStatus: input.providerStatus,
      },
    });

    return this.toCheckInAttemptRecord(attempt);
  }

  async markAttemptFailed(input: MarkCheckInAttemptFailedInput): Promise<CheckInAttemptRecord> {
    const attempt = await this.prisma.checkInAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: CheckInAttemptStatus.FAILED,
        completedAt: input.completedAt,
        failureReason: input.failureReason,
      },
    });

    return this.toCheckInAttemptRecord(attempt);
  }

  async markAttemptTimedOut(input: MarkCheckInAttemptTimedOutInput): Promise<CheckInAttemptRecord> {
    const attempt = await this.prisma.checkInAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: CheckInAttemptStatus.TIMED_OUT,
        completedAt: input.completedAt,
        failureReason: 'response_window_elapsed',
      },
    });

    return this.toCheckInAttemptRecord(attempt);
  }

  async markLatestSentAttemptResponded(input: { checkInId: string; completedAt: Date }): Promise<CheckInAttemptRecord | null> {
    const latest = await this.prisma.checkInAttempt.findFirst({
      where: { checkInId: input.checkInId, status: CheckInAttemptStatus.SENT },
      orderBy: { attemptNumber: 'desc' },
    });

    if (!latest) {
      return null;
    }

    const attempt = await this.prisma.checkInAttempt.update({
      where: { id: latest.id },
      data: {
        status: CheckInAttemptStatus.RESPONDED,
        completedAt: input.completedAt,
      },
    });

    return this.toCheckInAttemptRecord(attempt);
  }

  async skipPendingAttemptsForCheckIn(input: SkipPendingCheckInAttemptsInput): Promise<number> {
    const result = await this.prisma.checkInAttempt.updateMany({
      where: { checkInId: input.checkInId, status: CheckInAttemptStatus.PENDING },
      data: {
        status: CheckInAttemptStatus.SKIPPED,
        completedAt: input.completedAt,
        failureReason: input.failureReason,
      },
    });

    return result.count;
  }

  async markNeedsAttention(input: { checkInId: string }): Promise<CheckInRecord> {
    const checkIn = await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: {
        status: CheckInStatus.NEEDS_ATTENTION,
      },
    });

    return this.toCheckInRecord(checkIn);
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

  async markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord> {
    const checkIn = await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: {
        status: input.status,
        respondedAt: input.respondedAt,
        responseDetectedAs: input.responseDetectedAs,
        responseTranscript: input.responseTranscript,
      },
    });

    return this.toCheckInRecord(checkIn);
  }

  async markResolvedByBackupContact(input: { checkInId: string; resolvedAt: Date }): Promise<CheckInRecord> {
    const checkIn = await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: {
        status: CheckInStatus.RESOLVED,
        resolvedAt: input.resolvedAt,
      },
    });

    return this.toCheckInRecord(checkIn);
  }

  async findOverdueSentCheckIns(input: FindOverdueSentCheckInsInput): Promise<CheckInRecord[]> {
    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        status: CheckInStatus.SENT,
        sentAt: {
          lte: input.overdueBefore,
        },
      },
      orderBy: { sentAt: 'asc' },
    });

    return checkIns.map((checkIn) => this.toCheckInRecord(checkIn));
  }

  private isInsideScheduleWindow(scheduleTimeWindow: Prisma.JsonValue, now: Date, timezone: string): boolean {
    const window = this.toScheduleTimeWindow(scheduleTimeWindow);
    const start = typeof window.start === 'string' ? window.start : undefined;
    const end = typeof window.end === 'string' ? window.end : undefined;

    if (!start || !end) {
      return false;
    }

    const currentMinutes = this.localTimeToMinutes(now, timezone);
    const startMinutes = this.timeToMinutes(start);
    const endMinutes = this.timeToMinutes(end);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  private timeToMinutes(value: string): number {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      throw new Error('Schedule time must use HH:mm format');
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      throw new Error('Schedule time must be a valid 24-hour clock value');
    }

    return hours * 60 + minutes;
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

  private utcDayBounds(now: Date): { startOfDay: Date; startOfNextDay: Date } {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfNextDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return { startOfDay, startOfNextDay };
  }

  private toScheduleTimeWindow(value: Prisma.JsonValue): Prisma.JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Receiver schedule time window must be a JSON object');
    }

    return value;
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

  private toAttemptWithCheckInRecord(
    attempt: CheckInAttempt & { checkIn: CheckIn & { receiver: { phoneEncrypted: string; language: string } } },
  ): CheckInAttemptWithCheckInRecord {
    return {
      ...this.toCheckInAttemptRecord(attempt),
      checkIn: {
        ...this.toCheckInRecord(attempt.checkIn),
        receiverPhoneEncrypted: attempt.checkIn.receiver.phoneEncrypted,
        receiverLanguage: attempt.checkIn.receiver.language,
      },
    };
  }
}
