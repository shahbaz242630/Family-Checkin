import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel, RelationshipType, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type { CreateReceiverRecordInput, ReceiverRecord, ReceiversRepository, UpdateReceiverRecordInput } from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

const USER_PAUSED_UNTIL = new Date('9999-12-31T23:59:59.999Z');
const USER_PAUSED_REASON = 'USER_PAUSED';

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

export interface ReceiverSummary {
  id: string;
  displayName: string;
  phoneMasked: string;
  countryCode: string;
  relationshipType: RelationshipType;
  language: string;
  timezone: string;
  techProfile: TechProfile;
  primaryChannel: Channel;
  fallbackChannels: Channel[];
  scheduleFrequency: string;
  scheduleTimeWindow: Prisma.InputJsonObject;
  consentStatus: ConsentStatus;
  consentGrantedAt?: string;
  pausedUntil?: string;
  pausedReason?: string;
  latestCheckIn?: {
    id: string;
    status: string;
    scheduledAt: string;
    channelUsed?: Channel;
    sentAt?: string;
    respondedAt?: string;
    responseDetectedAs?: string;
    resolvedAt?: string;
    resolutionByUserId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ReceiverDetail extends ReceiverSummary {
  backupContacts: [];
  escalation: {
    configured: boolean;
    nextStep: string;
  };
}

export interface ReceiverManagementInput {
  userId: string;
  receiverId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResolveCheckInForSenderInput extends ReceiverManagementInput {
  checkInId: string;
}

export interface SenderCheckInActionInput extends ReceiverManagementInput {
  checkInId: string;
}

export interface UpdateReceiverForSenderInput extends ReceiverManagementInput {
  name: string;
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
}

@Injectable()
export class ReceiversService {
  private readonly now: () => Date;
  private readonly escalationsService?: Pick<EscalationsService, 'escalateSenderRequestedBackup'>;

  constructor(
    @Inject(RECEIVERS_REPOSITORY) private readonly receiversRepository: ReceiversRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional()
    @Inject(EscalationsService)
    escalationsOrNow?: Pick<EscalationsService, 'escalateSenderRequestedBackup'> | (() => Date),
  ) {
    if (typeof escalationsOrNow === 'function') {
      this.now = escalationsOrNow;
      this.escalationsService = undefined;
    } else {
      this.now = () => new Date();
      this.escalationsService = escalationsOrNow;
    }
  }

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

  async listForSender(userId: string): Promise<ReceiverSummary[]> {
    const receivers = await this.receiversRepository.findManyForUser(userId.trim());

    return receivers.map((receiver) => this.toSummary(receiver));
  }

  async getForSender(input: { userId: string; receiverId: string }): Promise<ReceiverDetail | null> {
    const receiver = await this.receiversRepository.findForUserById({
      userId: input.userId.trim(),
      receiverId: input.receiverId.trim(),
    });

    return receiver
      ? {
          ...this.toSummary(receiver),
          backupContacts: [],
          escalation: {
            configured: false,
            nextStep: 'Add backup contacts',
          },
        }
      : null;
  }

  async updateForSender(input: UpdateReceiverForSenderInput): Promise<ReceiverDetail | null> {
    const normalized = this.normalizeUpdateInput(input);
    const receiver = await this.receiversRepository.updateForUserById(this.toUpdateRecordInput(normalized));

    if (!receiver) {
      return null;
    }

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.updated',
      actorType: ActorType.USER,
      actorId: normalized.userId,
      metadata: {
        countryCode: normalized.countryCode,
        relationshipType: normalized.relationshipType,
        primaryChannel: normalized.primaryChannel,
        fallbackChannelCount: normalized.fallbackChannels.length,
        scheduleFrequency: normalized.scheduleFrequency,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return this.toDetail(receiver);
  }

  async pauseForSender(input: ReceiverManagementInput): Promise<ReceiverDetail | null> {
    const receiver = await this.receiversRepository.pauseForUserById({
      userId: input.userId.trim(),
      receiverId: input.receiverId.trim(),
      pausedUntil: USER_PAUSED_UNTIL,
      pausedReason: USER_PAUSED_REASON,
    });

    if (!receiver) {
      return null;
    }

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.paused',
      actorType: ActorType.USER,
      actorId: input.userId.trim(),
      metadata: {
        pausedReason: USER_PAUSED_REASON,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(receiver);
  }

  async resumeForSender(input: ReceiverManagementInput): Promise<ReceiverDetail | null> {
    const receiver = await this.receiversRepository.resumeForUserById({
      userId: input.userId.trim(),
      receiverId: input.receiverId.trim(),
    });

    if (!receiver) {
      return null;
    }

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.resumed',
      actorType: ActorType.USER,
      actorId: input.userId.trim(),
      metadata: {},
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(receiver);
  }

  async deleteForSender(input: ReceiverManagementInput): Promise<ReceiverDetail | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const receiver = await this.receiversRepository.deleteForUserById({
      userId,
      receiverId,
      deletedAt: new Date(),
    });

    if (!receiver) {
      return null;
    }

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.deleted',
      actorType: ActorType.USER,
      actorId: userId,
      metadata: {},
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(receiver);
  }

  async resolveCheckInForSender(input: ResolveCheckInForSenderInput): Promise<ReceiverDetail | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const checkInId = input.checkInId.trim();
    const receiverBeforeUpdate = await this.receiversRepository.findForUserById({ userId, receiverId });
    const actionableStatuses: CheckInStatus[] = [
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.ESCALATED,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ];

    if (
      !receiverBeforeUpdate?.latestCheckIn ||
      receiverBeforeUpdate.latestCheckIn.id !== checkInId ||
      !actionableStatuses.includes(receiverBeforeUpdate.latestCheckIn.status)
    ) {
      return null;
    }

    const receiver = await this.receiversRepository.resolveCheckInForUserById({
      userId,
      receiverId,
      checkInId,
      resolvedAt: this.now(),
      resolutionByUserId: userId,
    });

    if (!receiver) {
      return null;
    }

    await this.auditService.append({
      entityType: 'check_in',
      entityId: checkInId,
      action: 'check_in.resolved',
      actorType: ActorType.USER,
      actorId: userId,
      metadata: {
        receiverId,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(receiver);
  }

  async alertBackupForSender(input: SenderCheckInActionInput): Promise<ReceiverDetail | null> {
    const context = await this.findActionableLatestCheckIn(input, [
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ]);
    if (!context || !this.escalationsService) {
      return null;
    }

    await this.auditService.append({
      entityType: 'check_in',
      entityId: context.checkInId,
      action: 'check_in.backup_alert_requested',
      actorType: ActorType.USER,
      actorId: context.userId,
      metadata: {
        receiverId: context.receiverId,
        previousStatus: context.previousStatus,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.escalationsService.escalateSenderRequestedBackup({
      receiverId: context.receiverId,
      checkInId: context.checkInId,
    });

    const receiver = await this.receiversRepository.findForUserById({
      userId: context.userId,
      receiverId: context.receiverId,
    });

    return receiver ? this.toDetail(receiver) : null;
  }

  async tryCheckInLaterForSender(input: SenderCheckInActionInput): Promise<ReceiverDetail | null> {
    const context = await this.findActionableLatestCheckIn(input, [
      CheckInStatus.SENT,
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ]);
    if (!context) {
      return null;
    }

    await this.auditService.append({
      entityType: 'check_in',
      entityId: context.checkInId,
      action: 'check_in.try_later_requested',
      actorType: ActorType.USER,
      actorId: context.userId,
      metadata: {
        receiverId: context.receiverId,
        previousStatus: context.previousStatus,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(context.receiver);
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

  private toUpdateRecordInput(input: UpdateReceiverForSenderInput): UpdateReceiverRecordInput {
    return {
      userId: input.userId,
      receiverId: input.receiverId,
      nameEncrypted: this.cryptoService.encrypt(input.name),
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

  private normalizeUpdateInput(input: UpdateReceiverForSenderInput): UpdateReceiverForSenderInput {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const name = input.name.trim();
    const countryCode = input.countryCode.trim().toUpperCase();
    const language = input.language.trim();
    const timezone = input.timezone.trim();
    const scheduleFrequency = input.scheduleFrequency.trim();

    if (!userId) {
      throw new Error('Sender user id is required');
    }
    if (!receiverId) {
      throw new Error('Receiver id is required');
    }
    if (!name) {
      throw new Error('Receiver name is required');
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
      userId,
      receiverId,
      name,
      countryCode,
      language,
      timezone,
      scheduleFrequency,
      fallbackChannels: [...input.fallbackChannels],
      scheduleCustomCron: input.scheduleCustomCron?.trim() || undefined,
    };
  }

  private async findActionableLatestCheckIn(
    input: SenderCheckInActionInput,
    actionableStatuses: CheckInStatus[],
  ): Promise<{
    userId: string;
    receiverId: string;
    checkInId: string;
    previousStatus: CheckInStatus;
    receiver: ReceiverRecord & { latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']> };
  } | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const checkInId = input.checkInId.trim();
    const receiver = await this.receiversRepository.findForUserById({ userId, receiverId });

    if (
      !receiver?.latestCheckIn ||
      receiver.latestCheckIn.id !== checkInId ||
      !actionableStatuses.includes(receiver.latestCheckIn.status)
    ) {
      return null;
    }

    return {
      userId,
      receiverId,
      checkInId,
      previousStatus: receiver.latestCheckIn.status,
      receiver,
    };
  }

  private maskPhone(phone: string): string {
    return `*******${phone.slice(-4)}`;
  }

  private toSummary(receiver: ReceiverRecord & { latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']> }): ReceiverSummary {
    const phone = this.cryptoService.decrypt(receiver.phoneEncrypted);

    return {
      id: receiver.id,
      displayName: this.cryptoService.decrypt(receiver.nameEncrypted),
      phoneMasked: this.maskPhone(phone),
      countryCode: receiver.countryCode,
      relationshipType: receiver.relationshipType,
      language: receiver.language,
      timezone: receiver.timezone,
      techProfile: receiver.techProfile,
      primaryChannel: receiver.primaryChannel,
      fallbackChannels: receiver.fallbackChannels,
      scheduleFrequency: receiver.scheduleFrequency,
      scheduleTimeWindow: receiver.scheduleTimeWindow,
      consentStatus: receiver.consentStatus,
      consentGrantedAt: receiver.consentGrantedAt?.toISOString(),
      pausedUntil: receiver.pausedUntil?.toISOString(),
      pausedReason: receiver.pausedReason,
      latestCheckIn: receiver.latestCheckIn
        ? {
            id: receiver.latestCheckIn.id,
            status: receiver.latestCheckIn.status,
            scheduledAt: receiver.latestCheckIn.scheduledAt.toISOString(),
            channelUsed: receiver.latestCheckIn.channelUsed,
            sentAt: receiver.latestCheckIn.sentAt?.toISOString(),
            respondedAt: receiver.latestCheckIn.respondedAt?.toISOString(),
            responseDetectedAs: receiver.latestCheckIn.responseDetectedAs,
            resolvedAt: receiver.latestCheckIn.resolvedAt?.toISOString(),
            resolutionByUserId: receiver.latestCheckIn.resolutionByUserId,
          }
        : undefined,
      createdAt: receiver.createdAt.toISOString(),
      updatedAt: receiver.updatedAt.toISOString(),
    };
  }

  private toDetail(receiver: ReceiverRecord & { latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']> }): ReceiverDetail {
    return {
      ...this.toSummary(receiver),
      backupContacts: [],
      escalation: {
        configured: false,
        nextStep: 'Add backup contacts',
      },
    };
  }
}
