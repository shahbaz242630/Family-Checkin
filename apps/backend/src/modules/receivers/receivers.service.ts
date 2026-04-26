import { Inject, Injectable } from '@nestjs/common';
import { ActorType, ConsentStatus } from '@prisma/client';
import type { Channel, RelationshipType, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type { CreateReceiverRecordInput, ReceiverRecord, ReceiversRepository } from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

export interface CreateReceiverForSenderInput {
  userId: string;
  name: string;
  phone: string;
  phoneCountry?: string;
  countryCode: string;
  relationshipType: RelationshipType;
  language: string;
  timezone: string;
  techProfile: TechProfile;
  primaryChannel: Channel;
  fallbackChannels: Channel[];
  scheduleFrequency: string;
  scheduleTimeWindow: Prisma.InputJsonObject;
  scheduleCustomCron?: string;
  personalNote?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ReceiversService {
  constructor(
    @Inject(RECEIVERS_REPOSITORY) private readonly receiversRepository: ReceiversRepository,
    private readonly cryptoService: CryptoService,
    private readonly auditService: AuditService,
  ) {}

  async createForSender(input: CreateReceiverForSenderInput): Promise<ReceiverRecord> {
    const normalized = this.normalizeInput(input);
    const receiver = await this.receiversRepository.create(this.toCreateRecordInput(normalized));

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.created',
      actorType: ActorType.USER,
      actorId: normalized.userId,
      metadata: {
        consentStatus: ConsentStatus.PENDING,
        relationshipType: normalized.relationshipType,
        primaryChannel: normalized.primaryChannel,
        fallbackChannelCount: normalized.fallbackChannels.length,
        scheduleFrequency: normalized.scheduleFrequency,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return receiver;
  }

  private toCreateRecordInput(input: CreateReceiverForSenderInput): CreateReceiverRecordInput {
    const phone = normalizePhone(input.phone, input.phoneCountry);
    const personalNote = input.personalNote?.trim();

    return {
      userId: input.userId,
      nameEncrypted: this.cryptoService.encrypt(input.name),
      phoneEncrypted: this.cryptoService.encrypt(phone),
      phoneHash: this.cryptoService.hashForLookup(phone),
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
      personalNoteEncrypted: personalNote ? this.cryptoService.encrypt(personalNote) : undefined,
      consentStatus: ConsentStatus.PENDING,
    };
  }

  private normalizeInput(input: CreateReceiverForSenderInput): CreateReceiverForSenderInput {
    const name = input.name.trim();
    const phone = input.phone.trim();
    const countryCode = input.countryCode.trim().toUpperCase();
    const language = input.language.trim();
    const timezone = input.timezone.trim();
    const scheduleFrequency = input.scheduleFrequency.trim();

    if (!input.userId.trim()) {
      throw new Error('Sender user id is required');
    }
    if (!name) {
      throw new Error('Receiver name is required');
    }
    if (!phone) {
      throw new Error('Receiver phone is required');
    }
    if (!input.primaryChannel) {
      throw new Error('Receiver primary channel is required');
    }
    if (!countryCode) {
      throw new Error('Receiver country code is required');
    }
    if (!language) {
      throw new Error('Receiver language is required');
    }
    if (!timezone) {
      throw new Error('Receiver timezone is required');
    }
    if (!scheduleFrequency) {
      throw new Error('Receiver schedule frequency is required');
    }

    return {
      ...input,
      userId: input.userId.trim(),
      name,
      phone,
      countryCode,
      language,
      timezone,
      scheduleFrequency,
      fallbackChannels: [...input.fallbackChannels],
      scheduleCustomCron: input.scheduleCustomCron?.trim() || undefined,
      personalNote: input.personalNote?.trim() || undefined,
    };
  }
}
