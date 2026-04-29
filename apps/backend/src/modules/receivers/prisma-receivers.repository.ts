import { Inject, Injectable } from '@nestjs/common';
import { AbuseReportStatus } from '@prisma/client';
import type { Channel, CheckIn, Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CreateReceiverRecordInput,
  ReceiverRecord,
  ReceiversRepository,
  ReceiverWithLatestCheckInRecord,
  UpdateReceiverRecordInput,
} from './receivers.repository';

type ReceiverWithCheckIns = Receiver & { checkIns: CheckIn[] };

interface ReceiversPrismaClient {
  receiver: {
    create(args: { data: CreateReceiverRecordInput }): Promise<Receiver>;
    findMany(args: {
      where: { userId: string; deletedAt: null };
      include: { checkIns: { orderBy: { scheduledAt: 'desc' }; take: 1 } };
      orderBy: { createdAt: 'desc' };
    }): Promise<ReceiverWithCheckIns[]>;
    findFirst(args:
      | { where: { phoneHash: string; deletedAt: null } }
      | {
          where: { id: string; userId: string; deletedAt: null };
          include: { checkIns: { orderBy: { scheduledAt: 'desc' }; take: 1 } };
        }): Promise<Receiver | ReceiverWithCheckIns | null>;
    update(args: {
      where: { id: string };
      data: Partial<{
        consentRequestedAt: Date;
        consentTranscript: string;
        consentStatus: Receiver['consentStatus'];
        consentGrantedAt: Date;
        consentRevokedAt: Date;
        pausedUntil: Date | null;
        pausedReason: string;
      }>;
    }): Promise<Receiver>;
    updateMany(args: {
      where: { id: string; userId: string; deletedAt: null };
      data: Partial<{
        nameEncrypted: string;
        countryCode: string;
        relationshipType: Receiver['relationshipType'];
        language: string;
        timezone: string;
        techProfile: Receiver['techProfile'];
        primaryChannel: Receiver['primaryChannel'];
        fallbackChannels: Channel[];
        scheduleFrequency: string;
        scheduleTimeWindow: unknown;
        scheduleCustomCron: string;
        pausedUntil: Date | null;
        pausedReason: string | null;
        deletedAt: Date;
      }>;
    }): Promise<{ count: number }>;
  };
  abuseReport: {
    create(args: {
      data: {
        receiverId: string;
        reporterPhoneHash: string;
        reportContent?: string;
        reportedAt: Date;
      };
    }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }>;
  };
  optOutCooldown: {
    upsert(args: {
      where: { receiverId: string };
      create: {
        receiverId: string;
        optOutAt: Date;
        cooldownUntil: Date;
        optOutChannel: Channel;
        optOutKeyword?: string;
      };
      update: {
        optOutAt: Date;
        cooldownUntil: Date;
        optOutChannel: Channel;
        optOutKeyword?: string;
      };
    }): Promise<unknown>;
  };
}

@Injectable()
export class PrismaReceiversRepository implements ReceiversRepository {
  constructor(@Inject(PrismaService) private readonly prisma: ReceiversPrismaClient | PrismaService) {}

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    const receiver = await this.prisma.receiver.create({
      data: {
        userId: input.userId,
        nameEncrypted: input.nameEncrypted,
        phoneEncrypted: input.phoneEncrypted,
        phoneHash: input.phoneHash,
        countryCode: input.countryCode,
        relationshipType: input.relationshipType,
        language: input.language,
        timezone: input.timezone,
        techProfile: input.techProfile,
        primaryChannel: input.primaryChannel,
        fallbackChannels: input.fallbackChannels,
        scheduleFrequency: input.scheduleFrequency,
        scheduleTimeWindow: input.scheduleTimeWindow,
        scheduleCustomCron: input.scheduleCustomCron,
        personalNoteEncrypted: input.personalNoteEncrypted,
        consentStatus: input.consentStatus,
      },
    });

    return {
      ...this.toReceiverRecord(receiver),
    };
  }

  async findManyForUser(userId: string): Promise<ReceiverWithLatestCheckInRecord[]> {
    const receivers = (await this.prisma.receiver.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      include: {
        checkIns: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    })) as ReceiverWithCheckIns[];

    return receivers.map((receiver) => ({
      ...this.toReceiverRecord(receiver),
      latestCheckIn: receiver.checkIns[0] ? this.toLatestCheckInRecord(receiver.checkIns[0]) : undefined,
    }));
  }

  async findForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = (await this.prisma.receiver.findFirst({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      include: {
        checkIns: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
    })) as ReceiverWithCheckIns | null;

    return receiver
      ? {
          ...this.toReceiverRecord(receiver),
          latestCheckIn: receiver.checkIns[0] ? this.toLatestCheckInRecord(receiver.checkIns[0]) : undefined,
        }
      : null;
  }

  async updateForUserById(input: UpdateReceiverRecordInput): Promise<ReceiverWithLatestCheckInRecord | null> {
    const result = await this.prisma.receiver.updateMany({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      data: {
        nameEncrypted: input.nameEncrypted,
        countryCode: input.countryCode,
        relationshipType: input.relationshipType,
        language: input.language,
        timezone: input.timezone,
        techProfile: input.techProfile,
        primaryChannel: input.primaryChannel,
        fallbackChannels: input.fallbackChannels,
        scheduleFrequency: input.scheduleFrequency,
        scheduleTimeWindow: input.scheduleTimeWindow,
        scheduleCustomCron: input.scheduleCustomCron,
      },
    });

    return result.count > 0 ? await this.findForUserById(input) : null;
  }

  async pauseForUserById(input: {
    userId: string;
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const result = await this.prisma.receiver.updateMany({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      data: {
        pausedUntil: input.pausedUntil,
        pausedReason: input.pausedReason,
      },
    });

    return result.count > 0 ? await this.findForUserById(input) : null;
  }

  async resumeForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const result = await this.prisma.receiver.updateMany({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      data: {
        pausedUntil: null,
        pausedReason: null,
      },
    });

    return result.count > 0 ? await this.findForUserById(input) : null;
  }

  async deleteForUserById(input: { userId: string; receiverId: string; deletedAt: Date }): Promise<ReceiverWithLatestCheckInRecord | null> {
    const receiver = await this.findForUserById(input);
    if (!receiver) {
      return null;
    }

    const result = await this.prisma.receiver.updateMany({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      data: {
        deletedAt: input.deletedAt,
      },
    });

    return result.count > 0 ? { ...receiver, deletedAt: input.deletedAt } : null;
  }

  async findActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord | null> {
    const receiver = await this.prisma.receiver.findFirst({
      where: {
        phoneHash,
        deletedAt: null,
      },
    });

    return receiver ? this.toReceiverRecord(receiver as Receiver) : null;
  }

  async markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord> {
    const receiver = await this.prisma.receiver.update({
      where: { id: input.receiverId },
      data: {
        consentRequestedAt: input.consentRequestedAt,
        consentTranscript: input.consentTranscript,
      },
    });

    return this.toReceiverRecord(receiver);
  }

  async updateConsentResponse(input: {
    receiverId: string;
    consentStatus: Receiver['consentStatus'];
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  }): Promise<ReceiverRecord> {
    const receiver = await this.prisma.receiver.update({
      where: { id: input.receiverId },
      data: {
        consentStatus: input.consentStatus,
        consentTranscript: input.consentTranscript,
        consentGrantedAt: input.consentGrantedAt,
        consentRevokedAt: input.consentRevokedAt,
      },
    });

    return this.toReceiverRecord(receiver);
  }

  async upsertOptOutCooldown(input: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  }): Promise<void> {
    await this.prisma.optOutCooldown.upsert({
      where: { receiverId: input.receiverId },
      create: input,
      update: {
        optOutAt: input.optOutAt,
        cooldownUntil: input.cooldownUntil,
        optOutChannel: input.optOutChannel,
        optOutKeyword: input.optOutKeyword,
      },
    });
  }

  async createAbuseReport(input: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }> {
    return await this.prisma.abuseReport.create({
      data: input,
    });
  }

  async pauseForAbuseReview(input: { receiverId: string; pausedReason: string }): Promise<ReceiverRecord> {
    const receiver = await this.prisma.receiver.update({
      where: { id: input.receiverId },
      data: {
        pausedReason: input.pausedReason,
      },
    });

    return this.toReceiverRecord(receiver);
  }

  private toReceiverRecord(receiver: Receiver): ReceiverRecord {
    return {
      id: receiver.id,
      userId: receiver.userId,
      nameEncrypted: receiver.nameEncrypted,
      phoneEncrypted: receiver.phoneEncrypted,
      phoneHash: receiver.phoneHash,
      countryCode: receiver.countryCode,
      relationshipType: receiver.relationshipType,
      language: receiver.language,
      timezone: receiver.timezone,
      techProfile: receiver.techProfile,
      primaryChannel: receiver.primaryChannel,
      fallbackChannels: receiver.fallbackChannels,
      scheduleFrequency: receiver.scheduleFrequency,
      scheduleTimeWindow: this.toScheduleTimeWindow(receiver.scheduleTimeWindow),
      scheduleCustomCron: receiver.scheduleCustomCron ?? undefined,
      personalNoteEncrypted: receiver.personalNoteEncrypted ?? undefined,
      consentStatus: receiver.consentStatus,
      consentRequestedAt: receiver.consentRequestedAt ?? undefined,
      consentGrantedAt: receiver.consentGrantedAt ?? undefined,
      consentRevokedAt: receiver.consentRevokedAt ?? undefined,
      consentTranscript: receiver.consentTranscript ?? undefined,
      pausedUntil: receiver.pausedUntil ?? undefined,
      pausedReason: receiver.pausedReason ?? undefined,
      deletedAt: receiver.deletedAt ?? undefined,
      createdAt: receiver.createdAt,
      updatedAt: receiver.updatedAt,
    };
  }

  private toLatestCheckInRecord(checkIn: CheckIn): NonNullable<ReceiverWithLatestCheckInRecord['latestCheckIn']> {
    return {
      id: checkIn.id,
      status: checkIn.status,
      scheduledAt: checkIn.scheduledAt,
      channelUsed: checkIn.channelUsed ?? undefined,
      sentAt: checkIn.sentAt ?? undefined,
      respondedAt: checkIn.respondedAt ?? undefined,
      responseDetectedAs: checkIn.responseDetectedAs ?? undefined,
    };
  }

  private toScheduleTimeWindow(value: unknown): ReceiverRecord['scheduleTimeWindow'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Receiver schedule time window must be a JSON object');
    }

    return value as ReceiverRecord['scheduleTimeWindow'];
  }
}
