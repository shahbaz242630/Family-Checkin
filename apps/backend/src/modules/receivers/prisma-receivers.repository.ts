import { Injectable } from '@nestjs/common';
import type { Receiver } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CreateReceiverRecordInput, ReceiverRecord, ReceiversRepository } from './receivers.repository';

interface ReceiversPrismaClient {
  receiver: {
    create(args: { data: CreateReceiverRecordInput }): Promise<Receiver>;
    update(args: {
      where: { id: string };
      data: {
        consentRequestedAt: Date;
        consentTranscript: string;
      };
    }): Promise<Receiver>;
  };
}

@Injectable()
export class PrismaReceiversRepository implements ReceiversRepository {
  constructor(private readonly prisma: ReceiversPrismaClient | PrismaService) {}

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
      consentTranscript: receiver.consentTranscript ?? undefined,
      createdAt: receiver.createdAt,
      updatedAt: receiver.updatedAt,
    };
  }

  private toScheduleTimeWindow(value: unknown): ReceiverRecord['scheduleTimeWindow'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Receiver schedule time window must be a JSON object');
    }

    return value as ReceiverRecord['scheduleTimeWindow'];
  }
}
