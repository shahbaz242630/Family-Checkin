import { Inject, Injectable } from '@nestjs/common';
import { CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel, CheckIn, Prisma, Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CheckInReceiverCandidate,
  CheckInRecord,
  CheckInsRepository,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
  MarkCheckInRespondedInput,
} from './check-ins.repository';

type ReceiverDueForCheckIn = Pick<
  Receiver,
  | 'id'
  | 'phoneEncrypted'
  | 'language'
  | 'timezone'
  | 'primaryChannel'
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
    update(args: {
      where: { id: string };
      data: Partial<{
        status: CheckInStatus;
        channelUsed: Channel;
        sentAt: Date;
        respondedAt: Date;
        responseDetectedAs: string;
        responseTranscript: string;
      }>;
    }): Promise<CheckIn>;
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
      primaryChannel: receiver.primaryChannel,
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

  async findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null> {
    const checkIn = await this.prisma.checkIn.findFirst({
      where: {
        receiverId,
        status: { in: [CheckInStatus.PENDING, CheckInStatus.SENT] },
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
}
