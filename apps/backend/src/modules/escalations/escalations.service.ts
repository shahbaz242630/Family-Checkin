import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { ChannelSendResult, TemplatedMessage } from '../channels/channel-provider';
import { ChannelRouterService, type ReachableChannelPlan } from '../channels/channel-router.service';
import { renderingAuditMetadata } from '../channels/message-catalog.service';
import {
  DEFAULT_MESSAGE_LANGUAGE,
  NEUTRAL_RECEIVER_NAME_FOR_BACKUP_CONTACTS,
  NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
  describeChannelsTried,
} from '../channels/message-catalog.templates';
import { NotificationsService } from '../notifications/notifications.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { EscalationBackupContactRecord, EscalationsRepository } from './escalations.repository';
import { ESCALATIONS_REPOSITORY } from './escalations.tokens';

export interface EscalateHelpResponseInput {
  receiverId: string;
  checkInId: string;
  sourceChannel: Channel;
}

export interface EscalateMissedCheckInInput {
  receiverId: string;
  checkInId: string;
  sentAt: Date;
  responseWindowMinutes: number;
}

export interface EscalateSenderRequestedBackupInput {
  receiverId: string;
  checkInId: string;
}

export interface NotifySenderOfMissedCheckInInput {
  receiverId: string;
  checkInId: string;
}

export interface EscalateHelpResponseResult {
  checkInId: string;
  status: CheckInStatus;
  attempted: number;
  succeeded: number;
  failed: number;
}

/** What the sender's own "Alert backup contacts" action achieved, for the app to show (CB-074). */
export type SenderRequestedBackupOutcome = 'alerted' | 'no_backup_contacts' | 'all_failed';

export interface EscalateSenderRequestedBackupResult {
  outcome: SenderRequestedBackupOutcome;
  /** Backup contacts reached on at least one channel. */
  alerted: number;
  /** Backup contacts no channel could reach. */
  failed: number;
}

/** The siren push to the sender, or the reason it is deliberately withheld. */
type SenderSiren = { title: string; body: string } | { skipped: 'sender_initiated' };

type ChannelDetection = ReachableChannelPlan['detectionStatus'];

type BackupAlertDelivery =
  | {
      delivered: true;
      channel: Channel;
      providerResult: ChannelSendResult;
      attemptedChannels: Channel[];
      channelDetection: ChannelDetection;
    }
  | {
      delivered: false;
      /** The last channel tried, so the ERROR event names where the contact was finally given up on. */
      channel: Channel;
      attemptedChannels: Channel[];
      channelDetection: ChannelDetection;
    };

/** In-app route a sender siren opens. Ids only, so it is safe in audit metadata (CB-068). */
function receiverDeepLink(receiverId: string): string {
  return `/(main)/receivers/${receiverId}`;
}

/**
 * WhatsApp only when the router confirmed it for this number, then SMS; SMS alone otherwise. An unconfigured
 * WhatsApp provider throws from its availability check, which the router reports as `MANUAL_REQUIRED`, and a
 * number WhatsApp does not claim comes back as `FALLBACK_SELECTED` — either way SMS is the one channel worth an
 * attempt (CB-011).
 */
function backupAlertChannelOrder(plan: ReachableChannelPlan): Channel[] {
  return plan.detectionConfidence === 'provider_availability_check'
    ? [plan.primaryChannel, ...plan.fallbackChannels]
    : [Channel.SMS];
}

@Injectable()
export class EscalationsService {
  private readonly now: () => Date;
  private readonly notificationsService?: Pick<NotificationsService, 'sendToUser' | 'sendEscalationAlertToUser'>;

  constructor(
    @Inject(ESCALATIONS_REPOSITORY) private readonly escalationsRepository: EscalationsRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(ChannelRouterService)
    private readonly channelRouter: ChannelRouterService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional()
    @Inject(NotificationsService)
    notificationsOrNow?: Pick<NotificationsService, 'sendToUser' | 'sendEscalationAlertToUser'> | (() => Date),
    @Optional() now?: () => Date,
  ) {
    this.now = () => new Date();
    if (typeof notificationsOrNow === 'function') {
      this.now = notificationsOrNow;
    } else if (notificationsOrNow) {
      this.notificationsService = notificationsOrNow;
    }
    if (now) {
      this.now = now;
    }
  }

  async escalateHelpResponse(input: EscalateHelpResponseInput): Promise<EscalateHelpResponseResult> {
    return await this.escalateBackupContacts({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      templateKey: 'backup_contact_help_alert',
      reason: 'help_response',
      auditMetadata: {
        sourceChannel: input.sourceChannel,
      },
      noContactsMetadata: {
        sourceChannel: input.sourceChannel,
      },
      senderSiren: {
        title: 'Receiver needs attention',
        body: 'A receiver asked for help during a check-in.',
      },
    });
  }

  async escalateMissedCheckIn(input: EscalateMissedCheckInInput): Promise<EscalateHelpResponseResult> {
    return await this.escalateBackupContacts({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      templateKey: 'backup_contact_missed_checkin_alert',
      reason: 'missed_check_in',
      terminalNoContactsStatus: CheckInStatus.SKIPPED,
      terminalFailureStatus: CheckInStatus.FAILED,
      auditMetadata: {
        escalationReason: 'missed_check_in',
        sentAt: input.sentAt.toISOString(),
        responseWindowMinutes: input.responseWindowMinutes,
      },
      noContactsMetadata: {
        escalationReason: 'missed_check_in',
        sentAt: input.sentAt.toISOString(),
        responseWindowMinutes: input.responseWindowMinutes,
      },
      senderSiren: {
        title: 'Missed receiver check-in',
        body: 'A receiver missed a scheduled check-in.',
      },
    });
  }

  /**
   * The sender's own "Alert backup contacts" action. The sender already knows, so a sender-initiated alert must not
   * siren the sender (founder decision, CB-074): the push and its voice fallback are skipped and audited as such.
   * Returns what happened so the app can tell the sender.
   */
  async escalateSenderRequestedBackup(
    input: EscalateSenderRequestedBackupInput,
  ): Promise<EscalateSenderRequestedBackupResult> {
    const result = await this.escalateBackupContacts({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      templateKey: 'backup_contact_sender_requested_alert',
      reason: 'sender_requested',
      auditMetadata: {
        escalationReason: 'sender_requested',
      },
      noContactsMetadata: {
        escalationReason: 'sender_requested',
      },
      senderSiren: { skipped: 'sender_initiated' },
    });

    return {
      outcome: result.attempted === 0 ? 'no_backup_contacts' : result.succeeded > 0 ? 'alerted' : 'all_failed',
      alerted: result.succeeded,
      failed: result.failed,
    };
  }

  /**
   * Siren push to the sender, with a voice call when the push is not delivered, once every attempt of a
   * check-in's cascade has gone unanswered (CB-005). Backup contacts are deliberately not alerted here: BRD
   * FR-BAK-03 leaves that to the sender's own "alert backup" action, so the check-in status is untouched too.
   */
  async notifySenderOfMissedCheckIn(input: NotifySenderOfMissedCheckInInput): Promise<void> {
    await this.notifySender({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      title: 'Missed check-in',
      body: 'A receiver has not answered any check-in attempt today. Open the app to decide what to do next.',
      reason: 'cascade_exhausted',
      deepLink: receiverDeepLink(input.receiverId),
    });
  }

  private async escalateBackupContacts(input: {
    receiverId: string;
    checkInId: string;
    templateKey: string;
    /** Why this escalation is happening; goes into the alert variables and every sender-facing audit row. */
    reason: string;
    terminalNoContactsStatus?: CheckInStatus;
    terminalFailureStatus?: CheckInStatus;
    auditMetadata: Record<string, string | number>;
    noContactsMetadata: Record<string, string | number>;
    senderSiren: SenderSiren;
  }): Promise<EscalateHelpResponseResult> {
    const senderNotifiedAt = await this.sirenSender(input);
    const backupContacts = await this.escalationsRepository.findActiveBackupContactsForReceiver({
      receiverId: input.receiverId,
    });

    if (backupContacts.length === 0) {
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'escalation.no_backup_contacts',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          ...input.noContactsMetadata,
        },
      });

      if (input.terminalNoContactsStatus) {
        await this.escalationsRepository.markCheckInTerminal({
          checkInId: input.checkInId,
          status: input.terminalNoContactsStatus,
        });
        await this.auditService.append({
          entityType: 'check_in',
          entityId: input.checkInId,
          action: 'check_in.escalation_skipped',
          actorType: ActorType.SYSTEM,
          metadata: {
            receiverId: input.receiverId,
            reason: 'no_backup_contacts',
            escalationReason: 'missed_check_in',
          },
        });
      }

      return {
        checkInId: input.checkInId,
        status: input.terminalNoContactsStatus ?? CheckInStatus.RESPONDED_HELP,
        attempted: 0,
        succeeded: 0,
        failed: 0,
      };
    }

    let succeeded = 0;
    let failed = 0;
    const alert = await this.backupAlertContext({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      reason: input.reason,
    });

    for (const [index, contact] of backupContacts.entries()) {
      const alerted = await this.alertBackupContact({
        receiverId: input.receiverId,
        checkInId: input.checkInId,
        contact,
        attemptNumber: index + 1,
        templateKey: input.templateKey,
        language: alert.language,
        variables: alert.variables,
        senderNotifiedAt,
        auditMetadata: input.auditMetadata,
      });

      if (alerted) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    if (succeeded > 0) {
      await this.escalationsRepository.markCheckInEscalated({ checkInId: input.checkInId });
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'check_in.escalated',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          successfulAlerts: succeeded,
          failedAlerts: failed,
        },
      });
    } else if (input.terminalFailureStatus) {
      await this.escalationsRepository.markCheckInTerminal({
        checkInId: input.checkInId,
        status: input.terminalFailureStatus,
      });
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'check_in.escalation_failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          failedAlerts: failed,
          escalationReason: 'missed_check_in',
        },
      });
    }

    return {
      checkInId: input.checkInId,
      status: succeeded > 0 ? CheckInStatus.ESCALATED : (input.terminalFailureStatus ?? CheckInStatus.RESPONDED_HELP),
      attempted: backupContacts.length,
      succeeded,
      failed,
    };
  }

  /** The sender siren that opens a backup fan-out, or its audited absence when the sender asked for the alert. */
  private async sirenSender(input: {
    receiverId: string;
    checkInId: string;
    reason: string;
    senderSiren: SenderSiren;
  }): Promise<Date | undefined> {
    if ('skipped' in input.senderSiren) {
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'sender_push.skipped',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.senderSiren.skipped,
        },
      });
      return undefined;
    }

    return await this.notifySender({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      title: input.senderSiren.title,
      body: input.senderSiren.body,
      reason: input.reason,
      deepLink: receiverDeepLink(input.receiverId),
    });
  }

  /**
   * What every backup alert for this escalation says: who the receiver is, in their language, what was already
   * tried, and why. The sender's own name is not stored yet, so a neutral "their family member" stands in.
   * `receivers.language` is `char(5)`, so the stored value is trimmed before it reaches the catalog or a provider.
   */
  private async backupAlertContext(input: {
    receiverId: string;
    checkInId: string;
    reason: string;
  }): Promise<{ language: string; variables: Record<string, string> }> {
    const owner = await this.escalationsRepository.findReceiverOwner({ receiverId: input.receiverId });
    const channelsTried = describeChannelsTried(
      (await this.escalationsRepository.findChannelsTriedForCheckIn?.({ checkInId: input.checkInId })) ?? [],
    );

    return {
      language: owner?.receiverLanguage?.trim() || DEFAULT_MESSAGE_LANGUAGE,
      variables: {
        receiverName: owner?.receiverNameEncrypted
          ? this.cryptoService.decrypt(owner.receiverNameEncrypted)
          : NEUTRAL_RECEIVER_NAME_FOR_BACKUP_CONTACTS,
        senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
        reason: input.reason,
        ...(channelsTried ? { channelsTried } : {}),
      },
    };
  }

  /**
   * One alert per backup contact per pass (CB-011): WhatsApp first when the router says the number is reachable
   * there, SMS otherwise or when the WhatsApp send fails. Exactly one `escalation_event` records the outcome —
   * SUCCESS on the channel that accepted the message, or a single ERROR once every channel refused.
   */
  private async alertBackupContact(input: {
    receiverId: string;
    checkInId: string;
    contact: EscalationBackupContactRecord;
    attemptNumber: number;
    templateKey: string;
    language: string;
    variables: Record<string, string>;
    senderNotifiedAt?: Date;
    auditMetadata: Record<string, string | number>;
  }): Promise<boolean> {
    const startedAt = this.now();
    const delivery = await this.deliverBackupAlert(input);
    const deliveryMetadata = {
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      backupContactId: input.contact.id,
      channel: delivery.channel,
      attemptNumber: input.attemptNumber,
      attemptedChannels: delivery.attemptedChannels.join(','),
      channelDetection: delivery.channelDetection,
    };

    if (delivery.delivered) {
      const event = await this.escalationsRepository.createEvent({
        checkInId: input.checkInId,
        attemptNumber: input.attemptNumber,
        channel: delivery.channel,
        startedAt,
        completedAt: this.now(),
        result: EscalationResult.SUCCESS,
        senderNotifiedAt: input.senderNotifiedAt,
        backupAlertedAt: delivery.providerResult.acceptedAt,
      });

      await this.auditService.append({
        entityType: 'escalation_event',
        entityId: event.id,
        action: 'escalation.backup_contact_alerted',
        actorType: ActorType.SYSTEM,
        metadata: {
          ...deliveryMetadata,
          providerStatus: delivery.providerResult.providerStatus,
          ...renderingAuditMetadata(delivery.providerResult.rendering),
          ...input.auditMetadata,
        },
      });

      return true;
    }

    const event = await this.escalationsRepository.createEvent({
      checkInId: input.checkInId,
      attemptNumber: input.attemptNumber,
      channel: delivery.channel,
      startedAt,
      completedAt: this.now(),
      result: EscalationResult.ERROR,
      errorDetails: 'provider_send_failed',
      senderNotifiedAt: input.senderNotifiedAt,
    });

    await this.auditService.append({
      entityType: 'escalation_event',
      entityId: event.id,
      action: 'escalation.backup_contact_failed',
      actorType: ActorType.SYSTEM,
      metadata: {
        ...deliveryMetadata,
        ...input.auditMetadata,
      },
    });

    return false;
  }

  /**
   * Sends the alert on the first channel that accepts it and never throws; a contact no channel could reach comes
   * back as `delivered: false` so the caller records exactly one ERROR event. The contact's phone is decrypted
   * here, at the moment of the provider call, and nowhere else.
   */
  private async deliverBackupAlert(input: {
    contact: EscalationBackupContactRecord;
    templateKey: string;
    language: string;
    variables: Record<string, string>;
  }): Promise<BackupAlertDelivery> {
    const attemptedChannels: Channel[] = [];
    let channelDetection: ChannelDetection = 'MANUAL_REQUIRED';

    try {
      const phone = this.cryptoService.decrypt(input.contact.phoneEncrypted);
      const message = this.backupAlertMessage(input);
      const plan = await this.channelRouter.resolveReachablePlan({
        phone,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
      });
      channelDetection = plan.detectionStatus;

      for (const channel of backupAlertChannelOrder(plan)) {
        attemptedChannels.push(channel);
        try {
          const providerResult = await this.channelRouter.sendMessage(channel, phone, message);
          return { delivered: true, channel, providerResult, attemptedChannels, channelDetection };
        } catch {
          // The next channel, if any, gets its turn; the single ERROR event covers the contact as a whole.
        }
      }
    } catch {
      // Decrypting the contact or resolving the plan failed: nothing can be sent to this contact.
    }

    return {
      delivered: false,
      channel: attemptedChannels.at(-1) ?? Channel.SMS,
      attemptedChannels,
      channelDetection,
    };
  }

  private backupAlertMessage(input: {
    contact: EscalationBackupContactRecord;
    templateKey: string;
    language: string;
    variables: Record<string, string>;
  }): TemplatedMessage {
    const locationInstructions = input.contact.locationInstructionsEncrypted
      ? this.cryptoService.decrypt(input.contact.locationInstructionsEncrypted)
      : undefined;

    return {
      templateKey: input.templateKey,
      language: input.language,
      variables: {
        ...input.variables,
        contactName: this.cryptoService.decrypt(input.contact.nameEncrypted),
        ...(locationInstructions ? { locationInstructions } : {}),
      },
    };
  }

  private async notifySender(input: {
    receiverId: string;
    checkInId: string;
    title: string;
    body: string;
    reason: string;
    /** In-app route the push opens; also written to every `sender_push.*` and `sender_voice_fallback.*` row (CB-068). */
    deepLink: string;
  }): Promise<Date | undefined> {
    if (!this.notificationsService) {
      return undefined;
    }

    const owner = await this.escalationsRepository.findReceiverOwner({ receiverId: input.receiverId });
    if (!owner) {
      return undefined;
    }

    try {
      const result = await this.notificationsService.sendEscalationAlertToUser({
        userId: owner.userId,
        title: input.title,
        body: input.body,
        data: {
          checkInId: input.checkInId,
          receiverId: input.receiverId,
          reason: input.reason,
          deepLink: input.deepLink,
        },
      });

      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: result.sent > 0 ? 'sender_push.sent' : 'sender_push.not_delivered',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          attempted: result.attempted,
          sent: result.sent,
          failed: result.failed,
          reason: input.reason,
          deepLink: input.deepLink,
        },
      });

      if (result.sent > 0) {
        return result.sentAt;
      }

      await this.sendSenderVoiceFallback({
        ownerPhoneEncrypted: owner.phoneEncrypted,
        receiverId: input.receiverId,
        checkInId: input.checkInId,
        reason: input.reason,
        deepLink: input.deepLink,
      });
      return undefined;
    } catch {
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'sender_push.failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.reason,
          deepLink: input.deepLink,
        },
      });
      await this.sendSenderVoiceFallback({
        ownerPhoneEncrypted: owner.phoneEncrypted,
        receiverId: input.receiverId,
        checkInId: input.checkInId,
        reason: input.reason,
        deepLink: input.deepLink,
      });
      return undefined;
    }
  }

  private async sendSenderVoiceFallback(input: {
    ownerPhoneEncrypted: string;
    receiverId: string;
    checkInId: string;
    reason: string;
    deepLink: string;
  }): Promise<void> {
    try {
      const result = await this.channelRouter.makeVoiceCall(
        Channel.VOICE,
        this.cryptoService.decrypt(input.ownerPhoneEncrypted),
        {
          scriptKey: 'sender_escalation_siren_voice',
          language: 'en',
          variables: {
            checkInId: input.checkInId,
            receiverId: input.receiverId,
            reason: input.reason,
          },
        },
      );

      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'sender_voice_fallback.sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.reason,
          providerStatus: result.providerStatus,
          deepLink: input.deepLink,
        },
      });
    } catch {
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'sender_voice_fallback.failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.reason,
          deepLink: input.deepLink,
        },
      });
    }
  }
}
