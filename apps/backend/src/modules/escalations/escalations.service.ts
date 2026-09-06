import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
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

const BACKUP_CONTACT_ALERT_CHANNELS = [Channel.SMS, Channel.WHATSAPP] as const;

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
      auditMetadata: {
        sourceChannel: input.sourceChannel,
      },
      noContactsMetadata: {
        sourceChannel: input.sourceChannel,
      },
      senderPush: {
        title: 'Receiver needs attention',
        body: 'A receiver asked for help during a check-in.',
        reason: 'help_response',
      },
    });
  }

  async escalateMissedCheckIn(input: EscalateMissedCheckInInput): Promise<EscalateHelpResponseResult> {
    return await this.escalateBackupContacts({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      templateKey: 'backup_contact_missed_checkin_alert',
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
      senderPush: {
        title: 'Missed receiver check-in',
        body: 'A receiver missed a scheduled check-in.',
        reason: 'missed_check_in',
      },
    });
  }

  async escalateSenderRequestedBackup(input: EscalateSenderRequestedBackupInput): Promise<EscalateHelpResponseResult> {
    return await this.escalateBackupContacts({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      templateKey: 'backup_contact_sender_requested_alert',
      auditMetadata: {
        escalationReason: 'sender_requested',
      },
      noContactsMetadata: {
        escalationReason: 'sender_requested',
      },
      senderPush: {
        title: 'Backup alert requested',
        body: 'Backup contacts are being alerted for this check-in.',
        reason: 'sender_requested',
      },
    });
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
      deepLink: `/(main)/receivers/${input.receiverId}`,
    });
  }

  private async escalateBackupContacts(input: {
    receiverId: string;
    checkInId: string;
    templateKey: string;
    terminalNoContactsStatus?: CheckInStatus;
    terminalFailureStatus?: CheckInStatus;
    auditMetadata: Record<string, string | number>;
    noContactsMetadata: Record<string, string | number>;
    senderPush: {
      title: string;
      body: string;
      reason: string;
    };
  }): Promise<EscalateHelpResponseResult> {
    const senderNotifiedAt = await this.notifySender({
      receiverId: input.receiverId,
      checkInId: input.checkInId,
      ...input.senderPush,
    });
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
      reason: input.senderPush.reason,
    });

    for (const [index, contact] of backupContacts.entries()) {
      const attemptNumber = index + 1;
      const channelResults = await Promise.all(
        BACKUP_CONTACT_ALERT_CHANNELS.map((channel) =>
          this.alertBackupContactChannel({
            receiverId: input.receiverId,
            checkInId: input.checkInId,
            contact,
            attemptNumber,
            channel,
            templateKey: input.templateKey,
            language: alert.language,
            variables: alert.variables,
            senderNotifiedAt,
            auditMetadata: input.auditMetadata,
          }),
        ),
      );

      if (channelResults.some(Boolean)) {
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

  /**
   * What every backup alert for this escalation says: who the receiver is, in their language, what was already
   * tried, and why. The sender's own name is not stored yet, so a neutral "their family member" stands in.
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
      language: owner?.receiverLanguage ?? DEFAULT_MESSAGE_LANGUAGE,
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

  private async alertBackupContactChannel(input: {
    receiverId: string;
    checkInId: string;
    contact: EscalationBackupContactRecord;
    attemptNumber: number;
    channel: Channel;
    templateKey: string;
    language: string;
    variables: Record<string, string>;
    senderNotifiedAt?: Date;
    auditMetadata: Record<string, string | number>;
  }): Promise<boolean> {
    const startedAt = this.now();

    try {
      const locationInstructions = input.contact.locationInstructionsEncrypted
        ? this.cryptoService.decrypt(input.contact.locationInstructionsEncrypted)
        : undefined;
      const providerResult = await this.channelRouter.sendMessage(
        input.channel,
        this.cryptoService.decrypt(input.contact.phoneEncrypted),
        {
          templateKey: input.templateKey,
          language: input.language,
          variables: {
            ...input.variables,
            contactName: this.cryptoService.decrypt(input.contact.nameEncrypted),
            ...(locationInstructions ? { locationInstructions } : {}),
          },
        },
      );
      const event = await this.escalationsRepository.createEvent({
        checkInId: input.checkInId,
        attemptNumber: input.attemptNumber,
        channel: input.channel,
        startedAt,
        completedAt: this.now(),
        result: EscalationResult.SUCCESS,
        senderNotifiedAt: input.senderNotifiedAt,
        backupAlertedAt: providerResult.acceptedAt,
      });

      await this.auditService.append({
        entityType: 'escalation_event',
        entityId: event.id,
        action: 'escalation.backup_contact_alerted',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          checkInId: input.checkInId,
          backupContactId: input.contact.id,
          channel: input.channel,
          attemptNumber: input.attemptNumber,
          providerStatus: providerResult.providerStatus,
          ...renderingAuditMetadata(providerResult.rendering),
          ...input.auditMetadata,
        },
      });

      return true;
    } catch {
      const event = await this.escalationsRepository.createEvent({
        checkInId: input.checkInId,
        attemptNumber: input.attemptNumber,
        channel: input.channel,
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
          receiverId: input.receiverId,
          checkInId: input.checkInId,
          backupContactId: input.contact.id,
          channel: input.channel,
          attemptNumber: input.attemptNumber,
          ...input.auditMetadata,
        },
      });

      return false;
    }
  }

  private async notifySender(input: {
    receiverId: string;
    checkInId: string;
    title: string;
    body: string;
    reason: string;
    /** In-app route the push opens; `NotificationsService` falls back to the home tab when absent. */
    deepLink?: string;
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
          ...(input.deepLink ? { deepLink: input.deepLink } : {}),
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
        },
      });
      await this.sendSenderVoiceFallback({
        ownerPhoneEncrypted: owner.phoneEncrypted,
        receiverId: input.receiverId,
        checkInId: input.checkInId,
        reason: input.reason,
      });
      return undefined;
    }
  }

  private async sendSenderVoiceFallback(input: {
    ownerPhoneEncrypted: string;
    receiverId: string;
    checkInId: string;
    reason: string;
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
        },
      });
    }
  }
}
