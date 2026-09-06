import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import type { RelationshipType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { CheckInsRepository, CreatePendingCheckInInput } from '../check-ins/check-ins.repository';
import { CheckInsService } from '../check-ins/check-ins.service';
import { CHECK_INS_REPOSITORY } from '../check-ins/check-ins.tokens';
import { ChannelRouterService } from '../channels/channel-router.service';
import { NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import { assertSupportedTimeZone, parseScheduleTimeWindow } from '../../shared/schedule/receiver-schedule';
import {
  CheckInInProgressError,
  MAX_RESOLUTION_NOTE_LENGTH,
  OptOutCooldownError,
  ReceiverAlreadyMonitoredError,
  RESOLUTION_NOTE_TOO_LONG_MESSAGE,
  TRY_LATER_RETRY_OFFSET_MINUTES,
} from './receiver-policy';
import type {
  CreateReceiverRecordInput,
  ReceiverRecord,
  ReceiversRepository,
  ReceiverWithLatestCheckInRecord,
  UpdateReceiverRecordInput,
} from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

const USER_PAUSED_UNTIL = new Date('9999-12-31T23:59:59.999Z');
const USER_PAUSED_REASON = 'USER_PAUSED';
/** A check-in in one of these is still being delivered or awaiting the receiver; sender actions wait (CB-017). */
const IN_PROGRESS_CHECK_IN_STATUSES: CheckInStatus[] = [CheckInStatus.PENDING, CheckInStatus.SENT];
/** FR-REC-05: the personal note rides inside every check-in message, so it is capped at 50 characters. */
export const MAX_PERSONAL_NOTE_LENGTH = 50;
export const PERSONAL_NOTE_TOO_LONG_MESSAGE = `Receiver personal note must be ${MAX_PERSONAL_NOTE_LENGTH} characters or fewer`;

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
    /** Decrypted for the owning sender only (CB-018). */
    resolutionNote?: string;
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
  pausedUntil?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResolveCheckInForSenderInput extends ReceiverManagementInput {
  checkInId: string;
  /** Optional free text, at most `MAX_RESOLUTION_NOTE_LENGTH` characters; stored encrypted (CB-018). */
  note?: string;
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
  private readonly checkInsRepository?: Pick<CheckInsRepository, 'createPending' | 'createAttempts'>;
  private readonly channelRouter?: Pick<ChannelRouterService, 'sendMessage' | 'makeVoiceCall' | 'resolveReachablePlan'>;
  private readonly checkInsService?: Pick<CheckInsService, 'cancelOpenCheckInsForReceiver'>;

  constructor(
    @Inject(RECEIVERS_REPOSITORY) private readonly receiversRepository: ReceiversRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional()
    @Inject(CHECK_INS_REPOSITORY)
    checkInsOrEscalationsOrNow?:
      | Pick<CheckInsRepository, 'createPending' | 'createAttempts'>
      | Pick<EscalationsService, 'escalateSenderRequestedBackup'>
      | (() => Date),
    @Optional()
    @Inject(EscalationsService)
    escalationsOrNow?: Pick<EscalationsService, 'escalateSenderRequestedBackup'> | (() => Date),
    @Optional()
    @Inject(ChannelRouterService)
    channelRouter?: Pick<ChannelRouterService, 'sendMessage' | 'makeVoiceCall' | 'resolveReachablePlan'>,
    @Optional()
    @Inject(CheckInsService)
    checkInsService?: Pick<CheckInsService, 'cancelOpenCheckInsForReceiver'>,
  ) {
    this.channelRouter = channelRouter;
    this.checkInsService = checkInsService;
    this.now = () => new Date();
    if (this.isCheckInsRepository(checkInsOrEscalationsOrNow)) {
      this.checkInsRepository = checkInsOrEscalationsOrNow;
    } else if (typeof checkInsOrEscalationsOrNow === 'function') {
      this.now = checkInsOrEscalationsOrNow;
    } else {
      this.escalationsService = checkInsOrEscalationsOrNow;
    }

    if (typeof escalationsOrNow === 'function') {
      this.now = escalationsOrNow;
    } else if (escalationsOrNow) {
      this.escalationsService = escalationsOrNow;
    }
  }

  async createForSender(input: CreateReceiverForSenderInput): Promise<ReceiverRecord> {
    const normalized = await this.normalizeInput(input);
    const record = this.toCreateRecordInput(normalized);
    await this.assertPhoneCanBeInvited({
      userId: normalized.userId,
      phoneHash: record.phoneHash,
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });
    const receiver = await this.receiversRepository.create(record);

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
        channelDetectionStatus: normalized.channelDetectionStatus,
        channelDetectionConfidence: normalized.channelDetectionConfidence,
        unavailableChannels: normalized.unavailableChannels,
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
    const normalized = await this.normalizeUpdateInput(input);
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
        channelDetectionStatus: normalized.channelDetectionStatus,
        channelDetectionConfidence: normalized.channelDetectionConfidence,
        unavailableChannels: normalized.unavailableChannels,
      },
      ipAddress: normalized.ipAddress,
      userAgent: normalized.userAgent,
    });

    return this.toDetail(receiver);
  }

  async pauseForSender(input: ReceiverManagementInput): Promise<ReceiverDetail | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const pausedUntil = input.pausedUntil ?? USER_PAUSED_UNTIL;
    const receiver = await this.receiversRepository.pauseForUserById({
      userId,
      receiverId,
      pausedUntil,
      pausedReason: USER_PAUSED_REASON,
    });

    if (!receiver) {
      return null;
    }

    // Stop today's cascade too, or a fallback SMS or voice call still goes out after the pause (CB-008).
    await this.checkInsService?.cancelOpenCheckInsForReceiver({ receiverId: receiver.id, reason: 'receiver_paused' });

    await this.notifyReceiverLifecycle({
      receiver,
      actionName: 'pause',
      templateKey: 'receiver_checkins_paused',
      scriptKey: 'receiver_checkins_paused_voice',
      variables: this.lifecycleMessageVariables(receiver),
    });

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.paused',
      actorType: ActorType.USER,
      actorId: userId,
      metadata: {
        pausedReason: USER_PAUSED_REASON,
        pausedUntil: pausedUntil.toISOString(),
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

    await this.checkInsService?.cancelOpenCheckInsForReceiver({ receiverId: receiver.id, reason: 'receiver_deleted' });

    await this.notifyReceiverLifecycle({
      receiver,
      actionName: 'delete',
      templateKey: 'receiver_checkins_ended',
      scriptKey: 'receiver_checkins_ended_voice',
      variables: this.lifecycleMessageVariables(receiver),
    });

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
    const note = input.note?.trim() || undefined;
    if (note && Array.from(note).length > MAX_RESOLUTION_NOTE_LENGTH) {
      throw new Error(RESOLUTION_NOTE_TOO_LONG_MESSAGE);
    }
    const receiverBeforeUpdate = await this.receiversRepository.findForUserById({ userId, receiverId });
    const actionableStatuses: CheckInStatus[] = [
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.ESCALATED,
      CheckInStatus.NEEDS_ATTENTION,
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
      resolutionNote: note ? this.cryptoService.encrypt(note) : undefined,
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
        resolutionTextPresent: Boolean(note),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(receiver);
  }

  async alertBackupForSender(input: SenderCheckInActionInput): Promise<ReceiverDetail | null> {
    const context = await this.findActionableLatestCheckIn(input, [
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.NEEDS_ATTENTION,
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
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.NEEDS_ATTENTION,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ]);
    if (!context) {
      return null;
    }

    const retryAt = new Date(this.now().getTime() + TRY_LATER_RETRY_OFFSET_MINUTES * 60 * 1000);
    if (this.checkInsRepository) {
      // `retryOf` ties the retry to the check-in it repeats so the scheduler's same-day dedupe can tell a
      // sender-requested retry from a duplicate; the repository reads it once that dedupe lands.
      const retryInput: CreatePendingCheckInInput & { retryOf?: string } = {
        receiverId: context.receiverId,
        scheduledAt: retryAt,
        retryOf: context.checkInId,
      };
      const retryCheckIn = await this.checkInsRepository.createPending(retryInput);
      await this.checkInsRepository.createAttempts(
        this.buildRetryCascadeAttempts(context.receiver, retryCheckIn.id, retryAt),
      );
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
        ...(this.checkInsRepository ? { retryAt: retryAt.toISOString() } : {}),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return this.toDetail(context.receiver);
  }

  private buildRetryCascadeAttempts(
    receiver: ReceiverWithLatestCheckInRecord,
    checkInId: string,
    scheduledAt: Date,
  ): Array<{ checkInId: string; attemptNumber: number; channel: Channel; scheduledAt: Date }> {
    const channels =
      receiver.techProfile === TechProfile.VOICE_ONLY || receiver.techProfile === TechProfile.LANDLINE
        ? [receiver.primaryChannel]
        : [receiver.primaryChannel, ...receiver.fallbackChannels].filter(
            (channel, index, all) => all.indexOf(channel) === index,
          );
    const offsets = channels.map((channel, index) => {
      if (index === 0) return 0;
      const previous = channels[index - 1];
      return previous === 'WHATSAPP' ? 15 : index === 1 ? 30 : 45;
    });

    return channels.map((channel, index) => ({
      checkInId,
      attemptNumber: index + 1,
      channel,
      scheduledAt: new Date(scheduledAt.getTime() + (offsets[index] ?? 0) * 60 * 1000),
    }));
  }

  private isCheckInsRepository(
    value:
      | Pick<CheckInsRepository, 'createPending' | 'createAttempts'>
      | Pick<EscalationsService, 'escalateSenderRequestedBackup'>
      | (() => Date)
      | undefined,
  ): value is Pick<CheckInsRepository, 'createPending' | 'createAttempts'> {
    return typeof value === 'object' && value !== null && 'createPending' in value && 'createAttempts' in value;
  }

  /**
   * A phone that replied STOP stays off-limits until its cooldown lapses (FR-SAF-07, CB-009), and a phone
   * another sender already monitors cannot be added a second time until co-monitoring exists (CB-014).
   */
  private async assertPhoneCanBeInvited(input: {
    userId: string;
    phoneHash: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const now = this.now();
    const cooldown = await this.receiversRepository.findOptOutCooldownByPhoneHash(input.phoneHash);
    if (cooldown && cooldown.cooldownUntil > now) {
      await this.auditCreateRejected({
        ...input,
        existingReceiverId: cooldown.receiverId,
        metadata: { reason: 'opt_out_cooldown', cooldownUntil: cooldown.cooldownUntil.toISOString() },
      });
      throw new OptOutCooldownError(cooldown.cooldownUntil);
    }

    const monitoredElsewhere = (await this.receiversRepository.findManyActiveByPhoneHash(input.phoneHash)).find(
      (receiver) => receiver.userId !== input.userId,
    );
    if (monitoredElsewhere) {
      await this.auditCreateRejected({
        ...input,
        existingReceiverId: monitoredElsewhere.id,
        metadata: { reason: 'already_monitored' },
      });
      throw new ReceiverAlreadyMonitoredError();
    }
  }

  private async auditCreateRejected(input: {
    userId: string;
    existingReceiverId: string;
    metadata: Record<string, string>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.auditService.append({
      entityType: 'receiver',
      entityId: input.existingReceiverId,
      action: 'receiver.create_rejected',
      actorType: ActorType.USER,
      actorId: input.userId,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  private lifecycleMessageVariables(receiver: ReceiverRecord): Record<string, string> {
    return {
      receiverName: this.cryptoService.decrypt(receiver.nameEncrypted),
      senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME,
    };
  }

  private async notifyReceiverLifecycle(input: {
    receiver: ReceiverRecord;
    actionName: 'pause' | 'delete';
    templateKey: string;
    scriptKey: string;
    variables: Record<string, string>;
  }): Promise<void> {
    if (!this.channelRouter) {
      return;
    }

    const channel = input.receiver.primaryChannel;
    const phone = this.cryptoService.decrypt(input.receiver.phoneEncrypted);

    try {
      const result =
        channel === Channel.VOICE
          ? await this.channelRouter.makeVoiceCall(channel, phone, {
              scriptKey: input.scriptKey,
              language: input.receiver.language,
              variables: input.variables,
            })
          : await this.channelRouter.sendMessage(channel, phone, {
              templateKey: input.templateKey,
              language: input.receiver.language,
              variables: input.variables,
            });

      await this.auditService.append({
        entityType: 'receiver',
        entityId: input.receiver.id,
        action: `receiver.${input.actionName}_notification_sent`,
        actorType: ActorType.SYSTEM,
        actorId: undefined,
        metadata: {
          channel,
          providerStatus: result.providerStatus,
        },
      });
    } catch (error) {
      await this.auditService.append({
        entityType: 'receiver',
        entityId: input.receiver.id,
        action: `receiver.${input.actionName}_notification_failed`,
        actorType: ActorType.SYSTEM,
        actorId: undefined,
        metadata: {
          channel,
          error: error instanceof Error ? error.message : 'Unknown channel notification failure',
        },
      });
    }
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

  private async normalizeInput(input: CreateReceiverForSenderInput): Promise<
    CreateReceiverForSenderInput & {
      channelDetectionStatus: string;
      channelDetectionConfidence: string;
      unavailableChannels: Channel[];
    }
  > {
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
    const personalNote = input.personalNote?.trim() || undefined;
    if (personalNote && Array.from(personalNote).length > MAX_PERSONAL_NOTE_LENGTH) {
      throw new Error(PERSONAL_NOTE_TOO_LONG_MESSAGE);
    }
    // The scheduler evaluates these on every tick; an invalid value is rejected here rather than stalling
    // every receiver's check-in later (CB-004).
    assertSupportedTimeZone(timezone);
    const scheduleTimeWindow = parseScheduleTimeWindow(input.scheduleTimeWindow);

    const resolvedPhone = normalizePhone(phone, input.phoneCountry);
    const channelPlan = await this.resolveChannelPlan({
      phone: resolvedPhone,
      primaryChannel: input.primaryChannel,
      fallbackChannels: input.fallbackChannels,
    });

    return {
      ...input,
      userId: input.userId.trim(),
      name,
      phone,
      countryCode,
      language,
      timezone,
      scheduleFrequency,
      scheduleTimeWindow,
      primaryChannel: channelPlan.primaryChannel,
      fallbackChannels: channelPlan.fallbackChannels,
      scheduleCustomCron: input.scheduleCustomCron?.trim() || undefined,
      personalNote,
      channelDetectionStatus: channelPlan.detectionStatus,
      channelDetectionConfidence: channelPlan.detectionConfidence,
      unavailableChannels: channelPlan.unavailableChannels,
    };
  }

  private async normalizeUpdateInput(input: UpdateReceiverForSenderInput): Promise<
    UpdateReceiverForSenderInput & {
      channelDetectionStatus: string;
      channelDetectionConfidence: string;
      unavailableChannels: Channel[];
    }
  > {
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
    assertSupportedTimeZone(timezone);
    const scheduleTimeWindow = parseScheduleTimeWindow(input.scheduleTimeWindow);

    const existingReceiver = await this.receiversRepository.findForUserById({ userId, receiverId });
    const phone = existingReceiver ? this.cryptoService.decrypt(existingReceiver.phoneEncrypted) : '';
    const channelPlan = phone
      ? await this.resolveChannelPlan({
          phone,
          primaryChannel: input.primaryChannel,
          fallbackChannels: input.fallbackChannels,
        })
      : {
          primaryChannel: input.primaryChannel,
          fallbackChannels: [...input.fallbackChannels],
          detectionStatus: 'MANUAL_REQUIRED',
          detectionConfidence: 'manual_selection',
          unavailableChannels: [],
        };

    return {
      ...input,
      userId,
      receiverId,
      name,
      countryCode,
      language,
      timezone,
      scheduleFrequency,
      scheduleTimeWindow,
      primaryChannel: channelPlan.primaryChannel,
      fallbackChannels: channelPlan.fallbackChannels,
      scheduleCustomCron: input.scheduleCustomCron?.trim() || undefined,
      channelDetectionStatus: channelPlan.detectionStatus,
      channelDetectionConfidence: channelPlan.detectionConfidence,
      unavailableChannels: channelPlan.unavailableChannels,
    };
  }

  private async resolveChannelPlan(input: {
    phone: string;
    primaryChannel: Channel;
    fallbackChannels: Channel[];
  }): Promise<{
    primaryChannel: Channel;
    fallbackChannels: Channel[];
    detectionStatus: string;
    detectionConfidence: string;
    unavailableChannels: Channel[];
  }> {
    if (!this.channelRouter?.resolveReachablePlan) {
      return {
        primaryChannel: input.primaryChannel,
        fallbackChannels: [...input.fallbackChannels],
        detectionStatus: 'MANUAL_REQUIRED',
        detectionConfidence: 'manual_selection',
        unavailableChannels: [],
      };
    }

    return await this.channelRouter.resolveReachablePlan(input);
  }

  private async findActionableLatestCheckIn(
    input: SenderCheckInActionInput,
    actionableStatuses: CheckInStatus[],
  ): Promise<{
    userId: string;
    receiverId: string;
    checkInId: string;
    previousStatus: CheckInStatus;
    receiver: ReceiverRecord & {
      latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']>;
    };
  } | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const checkInId = input.checkInId.trim();
    const receiver = await this.receiversRepository.findForUserById({ userId, receiverId });

    if (!receiver?.latestCheckIn || receiver.latestCheckIn.id !== checkInId) {
      return null;
    }
    // A second cascade on top of one still running would double-message the receiver (CB-017).
    if (IN_PROGRESS_CHECK_IN_STATUSES.includes(receiver.latestCheckIn.status)) {
      throw new CheckInInProgressError();
    }
    if (!actionableStatuses.includes(receiver.latestCheckIn.status)) {
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

  private toSummary(
    receiver: ReceiverRecord & {
      latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']>;
    },
  ): ReceiverSummary {
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
            resolutionNote: receiver.latestCheckIn.resolutionNote
              ? this.cryptoService.decrypt(receiver.latestCheckIn.resolutionNote)
              : undefined,
            resolutionByUserId: receiver.latestCheckIn.resolutionByUserId,
          }
        : undefined,
      createdAt: receiver.createdAt.toISOString(),
      updatedAt: receiver.updatedAt.toISOString(),
    };
  }

  private toDetail(
    receiver: ReceiverRecord & {
      latestCheckIn?: NonNullable<Awaited<ReturnType<ReceiversRepository['findManyForUser']>>[number]['latestCheckIn']>;
    },
  ): ReceiverDetail {
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
