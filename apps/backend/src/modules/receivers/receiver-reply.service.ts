import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { AuditMetadata } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import type { BackupContactsRepository } from '../backup-contacts/backup-contacts.repository';
import { BACKUP_CONTACTS_REPOSITORY } from '../backup-contacts/backup-contacts.tokens';
import { ChannelRouterService } from '../channels/channel-router.service';
import { renderingAuditMetadata } from '../channels/message-catalog.service';
import { NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import type { CheckInRecord, CheckInsRepository } from '../check-ins/check-ins.repository';
import { CheckInsService } from '../check-ins/check-ins.service';
import { CHECK_INS_REPOSITORY } from '../check-ins/check-ins.tokens';
import { EscalationsService } from '../escalations/escalations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import { ABUSE_REVIEW_PAUSE_REASON } from './abuse-review-pause';
import { addDays, auditSafeErrorMessage, MAX_RESOLUTION_NOTE_LENGTH, OPT_OUT_COOLDOWN_DAYS } from './receiver-policy';
import type { ReceiverRecord, ReceiversRepository } from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

export interface HandleInboundReceiverReplyInput {
  fromPhone: string;
  channel: Channel;
  body: string;
  providerMessageId?: string;
  providerReceivedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface HandleInboundReceiverReplyResult {
  /** Empty when the reply could not be attributed to a receiver or backup contact (unknown or invalid sender). */
  receiverId: string;
  action: string;
  consentStatus?: ConsentStatus;
  checkInId?: string;
  checkInStatus?: CheckInStatus;
  backupContactId?: string;
}

/** Why the sender is being told; travels in the push `data.reason` and the `sender_push.*` audit rows (CB-012). */
export type QuietSenderPushReason =
  'consent_granted' | 'consent_declined' | 'receiver_opted_out' | 'backup_contact_done';

/**
 * Push copy never names the receiver: it transits Expo's servers and lands on a lock screen. The deep link takes
 * the sender to the receiver, where the name is shown after sign-in.
 */
const QUIET_SENDER_PUSH_COPY: Record<QuietSenderPushReason, { title: string; body: string }> = {
  consent_granted: {
    title: 'Consent received',
    body: 'Your receiver agreed to Nearby check-ins. Daily check-ins start in their next window.',
  },
  consent_declined: {
    title: 'Consent declined',
    body: 'Your receiver declined Nearby check-ins. Nearby will not message them.',
  },
  receiver_opted_out: {
    title: 'Check-ins stopped',
    body: 'Your receiver replied STOP. Check-ins have ended and they cannot be re-invited for 7 days.',
  },
  backup_contact_done: {
    title: 'Backup contact reached them',
    body: 'A backup contact confirmed they reached your receiver. The check-in is resolved.',
  },
};

/**
 * audit_logs.entity_id is a UUID column, so replies that cannot be attributed to any receiver or backup contact
 * are grouped under entityType 'inbound_reply' with this nil-UUID entity id.
 */
const UNATTRIBUTED_INBOUND_REPLY_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const SENDER_HASH_PREFIX_LENGTH = 12;
/** Prefix that tells the sender, reading the resolution note later, where this line came from (CB-018). */
const BACKUP_REPLY_NOTE_PREFIX = 'Backup contact reply: ';

type ReceiverReplyKeyword = 'YES' | 'NO' | 'STOP' | 'REPORT' | 'UNKNOWN';

interface ConsentTransition {
  action: 'consent_granted' | 'consent_declined' | 'consent_revoked';
  consentStatus: ConsentStatus;
  pushReason: QuietSenderPushReason;
}

@Injectable()
export class ReceiverReplyService {
  constructor(
    @Inject(RECEIVERS_REPOSITORY) private readonly receiversRepository: ReceiversRepository,
    @Inject(CHECK_INS_REPOSITORY) private readonly checkInsRepository: CheckInsRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional()
    @Inject(EscalationsService)
    private readonly escalationsService?: Pick<EscalationsService, 'escalateHelpResponse'>,
    @Optional()
    @Inject(BACKUP_CONTACTS_REPOSITORY)
    private readonly backupContactsRepository?: Pick<BackupContactsRepository, 'findActiveByPhoneHash'>,
    @Optional() private readonly now: () => Date = () => new Date(),
    @Optional()
    @Inject(CheckInsService)
    private readonly checkInsService?: Pick<CheckInsService, 'cancelOpenCheckInsForReceiver'>,
    @Optional()
    @Inject(NotificationsService)
    private readonly notificationsService?: Pick<NotificationsService, 'sendQuietUpdateToUser'>,
    @Optional()
    @Inject(ChannelRouterService)
    private readonly channelRouter?: Pick<ChannelRouterService, 'sendMessage' | 'makeVoiceCall'>,
    // Names the sender in the STOP confirmation, like the pause and delete messages do (CB-079).
    @Optional()
    @Inject(UsersService)
    private readonly usersService?: Pick<UsersService, 'senderDisplayNameFor'>,
  ) {}

  async handleInboundReply(input: HandleInboundReceiverReplyInput): Promise<HandleInboundReceiverReplyResult> {
    const receivedAt = this.now();
    const normalizedPhone = this.tryNormalizePhone(input.fromPhone);
    if (!normalizedPhone) {
      return this.handleInvalidSender(input);
    }

    const phoneHash = this.cryptoService.hashForLookup(normalizedPhone);
    // With several rows for one phone, the repository returns the one with the most recent open check-in, else
    // the newest row (CB-014); consent replies below still fan out to every row.
    const receiver = await this.receiversRepository.findActiveByPhoneHash(phoneHash);

    if (!receiver) {
      return this.handleBackupContactReply({
        phoneHash,
        input,
        receivedAt,
      });
    }

    const normalizedReply = this.normalizeReceiverReply(input.body);
    if (normalizedReply === 'REPORT') {
      await this.handleReportReply({
        receiverId: receiver.id,
        phoneHash,
        input,
        receivedAt,
      });

      return {
        receiverId: receiver.id,
        action: 'abuse_reported',
        consentStatus: receiver.consentStatus,
      };
    }

    if (receiver.consentStatus === ConsentStatus.GRANTED && (normalizedReply === 'YES' || normalizedReply === 'NO')) {
      const checkInResponse = await this.handleCheckInReply({
        receiverId: receiver.id,
        normalizedReply,
        input,
        receivedAt,
      });
      if (!checkInResponse) {
        return {
          receiverId: receiver.id,
          action: 'no_open_check_in',
          consentStatus: receiver.consentStatus,
        };
      }

      return {
        receiverId: receiver.id,
        action: checkInResponse.action,
        consentStatus: receiver.consentStatus,
        checkInId: checkInResponse.checkIn.id,
        checkInStatus: checkInResponse.checkIn.status,
      };
    }

    const transition = this.toConsentTransition(normalizedReply);
    if (!transition) {
      // Free text such as "Thanks, I'm fine" must return 200 to the provider, not 500 (CB-015).
      await this.auditUnactionedReply(input, {
        entityType: 'receiver',
        entityId: receiver.id,
        action: 'receiver.reply_unrecognised',
        metadata: {
          channel: input.channel,
          normalizedReply,
          providerMessageId: input.providerMessageId,
          bodyLength: input.body.length,
          consentStatus: receiver.consentStatus,
        },
      });

      return {
        receiverId: receiver.id,
        action: 'unrecognised_reply',
        consentStatus: receiver.consentStatus,
      };
    }

    if (transition.consentStatus === ConsentStatus.GRANTED) {
      // A YES inside the STOP cooldown does not re-grant consent: the phone asked to be left alone for 7 days
      // and a stray or coerced reply must not undo that (FR-SAF-07, CB-009).
      const cooldown = await this.receiversRepository.findOptOutCooldownByPhoneHash(phoneHash);
      if (cooldown && cooldown.cooldownUntil > receivedAt) {
        await this.auditUnactionedReply(input, {
          entityType: 'receiver',
          entityId: receiver.id,
          action: 'receiver.consent_ignored_cooldown',
          metadata: {
            channel: input.channel,
            normalizedReply,
            providerMessageId: input.providerMessageId,
            cooldownUntil: cooldown.cooldownUntil.toISOString(),
          },
        });

        return {
          receiverId: receiver.id,
          action: 'consent_ignored_cooldown',
          consentStatus: receiver.consentStatus,
        };
      }
    }

    const rows = await this.receiverRowsSharingPhone(receiver, phoneHash);
    const consentTranscript = this.cryptoService.encrypt(
      JSON.stringify({
        receivedAt: receivedAt.toISOString(),
        channel: input.channel,
        normalizedReply,
        providerMessageId: input.providerMessageId,
        providerReceivedAt: input.providerReceivedAt?.toISOString(),
      }),
    );
    let resolvedConsentStatus = receiver.consentStatus;

    for (const row of rows) {
      const updatedRow = await this.receiversRepository.updateConsentResponse({
        receiverId: row.id,
        consentStatus: transition.consentStatus,
        consentGrantedAt: transition.consentStatus === ConsentStatus.GRANTED ? receivedAt : undefined,
        consentRevokedAt: transition.consentStatus === ConsentStatus.REVOKED ? receivedAt : undefined,
        consentTranscript,
      });
      if (row.id === receiver.id) {
        resolvedConsentStatus = updatedRow.consentStatus;
      }

      await this.auditService.append({
        entityType: 'receiver',
        entityId: row.id,
        action: `receiver.${transition.action}`,
        actorType: ActorType.SYSTEM,
        metadata: {
          channel: input.channel,
          normalizedReply,
          providerMessageId: input.providerMessageId,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    }

    if (normalizedReply === 'STOP') {
      for (const row of rows) {
        await this.receiversRepository.upsertOptOutCooldown({
          receiverId: row.id,
          optOutAt: receivedAt,
          cooldownUntil: addDays(receivedAt, OPT_OUT_COOLDOWN_DAYS),
          optOutChannel: input.channel,
          optOutKeyword: normalizedReply,
        });
        // Opting out must be immediate: a fallback attempt scheduled for later today is cancelled now (CB-008).
        await this.checkInsService?.cancelOpenCheckInsForReceiver({
          receiverId: row.id,
          reason: 'receiver_opted_out',
        });
      }
      await this.confirmOptOutToReceiver(receiver, input);
    }

    await this.notifySendersQuietly(rows, transition.pushReason);

    return {
      receiverId: receiver.id,
      action: transition.action,
      consentStatus: resolvedConsentStatus,
    };
  }

  private tryNormalizePhone(fromPhone: string): string | null {
    try {
      return normalizePhone(fromPhone);
    } catch {
      // Short codes and alphanumeric sender ids are not E.164 and can never map to a receiver.
      return null;
    }
  }

  /** The resolved row first, then every other non-deleted row for the phone (CB-014). */
  private async receiverRowsSharingPhone(receiver: ReceiverRecord, phoneHash: string): Promise<ReceiverRecord[]> {
    const others = await this.receiversRepository.findManyActiveByPhoneHash(phoneHash);

    return [receiver, ...others.filter((row) => row.id !== receiver.id)];
  }

  private async handleInvalidSender(input: HandleInboundReceiverReplyInput): Promise<HandleInboundReceiverReplyResult> {
    await this.auditUnactionedReply(input, {
      entityType: 'inbound_reply',
      entityId: UNATTRIBUTED_INBOUND_REPLY_ENTITY_ID,
      action: 'inbound_reply.invalid_sender',
      metadata: {
        channel: input.channel,
        providerMessageId: input.providerMessageId,
        bodyLength: input.body.length,
      },
    });

    return { receiverId: '', action: 'invalid_sender' };
  }

  private async auditUnactionedReply(
    input: HandleInboundReceiverReplyInput,
    entry: { entityType: string; entityId: string; action: string; metadata: AuditMetadata },
  ): Promise<void> {
    await this.auditService.append({
      ...entry,
      actorType: ActorType.SYSTEM,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }

  private normalizeReceiverReply(body: string): ReceiverReplyKeyword {
    const normalized = body.trim().toUpperCase();
    if (['YES', 'Y', '1', 'OK', "I'M FINE", 'IM FINE', 'I AM FINE'].includes(normalized)) {
      return 'YES';
    }
    if (['NO', 'N', '2', 'HELP', 'NEED HELP'].includes(normalized)) {
      return 'NO';
    }
    if (normalized === 'STOP') {
      return 'STOP';
    }
    if (normalized === 'REPORT') {
      return 'REPORT';
    }
    return 'UNKNOWN';
  }

  private normalizeBackupContactReply(body: string): 'DONE' | 'UNKNOWN' {
    const normalized = body.trim().toUpperCase();
    if (['DONE', 'CHECKED', 'RESOLVED'].includes(normalized)) {
      return 'DONE';
    }
    return 'UNKNOWN';
  }

  private toConsentTransition(reply: ReceiverReplyKeyword): ConsentTransition | null {
    if (reply === 'YES') {
      return {
        action: 'consent_granted',
        consentStatus: ConsentStatus.GRANTED,
        pushReason: 'consent_granted',
      };
    }

    if (reply === 'NO') {
      return {
        action: 'consent_declined',
        consentStatus: ConsentStatus.DECLINED,
        pushReason: 'consent_declined',
      };
    }

    if (reply === 'STOP') {
      return {
        action: 'consent_revoked',
        consentStatus: ConsentStatus.REVOKED,
        pushReason: 'receiver_opted_out',
      };
    }

    return null;
  }

  /**
   * One STOP confirmation to the phone, on the channel the STOP arrived on, from the message catalog in the
   * receiver's language. It names the sender the way every other receiver message does (CB-079); the catalog
   * localises the neutral fallback when no name is stored. Best effort: a provider failure is audited and never
   * undoes the opt-out (CB-012).
   */
  private async confirmOptOutToReceiver(
    receiver: ReceiverRecord,
    input: HandleInboundReceiverReplyInput,
  ): Promise<void> {
    if (!this.channelRouter) {
      return;
    }

    const channel = input.channel;
    const templateKey = channel === Channel.VOICE ? 'receiver_checkins_ended_voice' : 'receiver_checkins_ended';
    try {
      const to = this.cryptoService.decrypt(receiver.phoneEncrypted);
      const variables = {
        receiverName: this.cryptoService.decrypt(receiver.nameEncrypted),
        senderDisplayName:
          (await this.usersService?.senderDisplayNameFor(receiver.userId)) ?? NEUTRAL_SENDER_DISPLAY_NAME,
      };
      const result =
        channel === Channel.VOICE
          ? await this.channelRouter.makeVoiceCall(channel, to, {
              scriptKey: templateKey,
              language: receiver.language,
              variables,
            })
          : await this.channelRouter.sendMessage(channel, to, { templateKey, language: receiver.language, variables });

      await this.auditService.append({
        entityType: 'receiver',
        entityId: receiver.id,
        action: 'receiver.opt_out_confirmation_sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel,
          templateKey,
          providerStatus: result.providerStatus,
          ...renderingAuditMetadata('rendering' in result ? result.rendering : undefined),
        },
      });
    } catch (error) {
      await this.auditService.append({
        entityType: 'receiver',
        entityId: receiver.id,
        action: 'receiver.opt_out_confirmation_failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          channel,
          templateKey,
          error: auditSafeErrorMessage(error, 'Unknown channel failure'),
        },
      });
    }
  }

  /** One quiet push per distinct sender among the rows, each deep-linking to that sender's own receiver row. */
  private async notifySendersQuietly(rows: ReceiverRecord[], reason: QuietSenderPushReason): Promise<void> {
    const notified = new Set<string>();
    for (const row of rows) {
      if (notified.has(row.userId)) {
        continue;
      }
      notified.add(row.userId);
      await this.pushQuietUpdateToSender({ userId: row.userId, receiverId: row.id, reason });
    }
  }

  /**
   * Routine sender update with the default sound (CB-012). Never throws: the inbound reply has already been
   * applied and must be answered 200 whatever the push gateway does (CB-015).
   */
  private async pushQuietUpdateToSender(input: {
    userId: string;
    receiverId: string;
    reason: QuietSenderPushReason;
    checkInId?: string;
  }): Promise<void> {
    if (!this.notificationsService) {
      return;
    }

    const copy = QUIET_SENDER_PUSH_COPY[input.reason];
    const deepLink = `/(main)/receivers/${input.receiverId}`;
    const entity = input.checkInId
      ? { entityType: 'check_in', entityId: input.checkInId }
      : { entityType: 'receiver', entityId: input.receiverId };

    try {
      const result = await this.notificationsService.sendQuietUpdateToUser({
        userId: input.userId,
        title: copy.title,
        body: copy.body,
        data: {
          receiverId: input.receiverId,
          ...(input.checkInId ? { checkInId: input.checkInId } : {}),
          reason: input.reason,
          deepLink,
        },
      });

      await this.auditService.append({
        ...entity,
        action: result.sent > 0 ? 'sender_push.sent' : 'sender_push.not_delivered',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          attempted: result.attempted,
          sent: result.sent,
          failed: result.failed,
          reason: input.reason,
          deepLink,
        },
      });
    } catch (error) {
      await this.auditService.append({
        ...entity,
        action: 'sender_push.failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.reason,
          deepLink,
          error: auditSafeErrorMessage(error, 'Unknown push failure'),
        },
      });
    }
  }

  private async handleReportReply(input: {
    receiverId: string;
    phoneHash: string;
    input: HandleInboundReceiverReplyInput;
    receivedAt: Date;
  }): Promise<void> {
    const report = await this.receiversRepository.createAbuseReport({
      receiverId: input.receiverId,
      reporterPhoneHash: input.phoneHash,
      reportContent: this.cryptoService.encrypt(input.input.body.trim()),
      reportedAt: input.receivedAt,
    });

    await this.receiversRepository.pauseForAbuseReview({
      receiverId: input.receiverId,
      pausedReason: ABUSE_REVIEW_PAUSE_REASON,
    });
    // A receiver paused for review must receive nothing further from a cascade already running today (CB-008).
    await this.checkInsService?.cancelOpenCheckInsForReceiver({
      receiverId: input.receiverId,
      reason: 'abuse_reported',
    });

    await this.auditService.append({
      entityType: 'receiver',
      entityId: input.receiverId,
      action: 'receiver.abuse_reported',
      actorType: ActorType.SYSTEM,
      metadata: {
        channel: input.input.channel,
        normalizedReply: 'REPORT',
        providerMessageId: input.input.providerMessageId,
        reviewStatus: report.reviewStatus,
      },
      ipAddress: input.input.ipAddress,
      userAgent: input.input.userAgent,
    });
  }

  private async handleCheckInReply(input: {
    receiverId: string;
    normalizedReply: 'YES' | 'NO';
    input: HandleInboundReceiverReplyInput;
    receivedAt: Date;
  }): Promise<{ action: 'check_in_responded_ok' | 'check_in_responded_help'; checkIn: CheckInRecord } | null> {
    const openCheckIn = await this.checkInsRepository.findLatestOpenForReceiver(input.receiverId);
    if (!openCheckIn) {
      // A late or repeated YES/HELP after the check-in closed: nothing to update, but keep the trail (CB-015).
      await this.auditUnactionedReply(input.input, {
        entityType: 'receiver',
        entityId: input.receiverId,
        action: 'receiver.check_in_reply_ignored',
        metadata: {
          channel: input.input.channel,
          normalizedReply: input.normalizedReply,
          providerMessageId: input.input.providerMessageId,
          reason: 'no_open_check_in',
        },
      });
      return null;
    }

    const responseDetectedAs = input.normalizedReply === 'YES' ? 'ok' : 'help';
    const status = responseDetectedAs === 'ok' ? CheckInStatus.RESPONDED_OK : CheckInStatus.RESPONDED_HELP;
    const action = responseDetectedAs === 'ok' ? 'check_in_responded_ok' : 'check_in_responded_help';
    const checkIn = await this.checkInsRepository.markResponded({
      checkInId: openCheckIn.id,
      status,
      respondedAt: input.receivedAt,
      responseDetectedAs,
      responseTranscript: this.cryptoService.encrypt(
        JSON.stringify({
          receivedAt: input.receivedAt.toISOString(),
          channel: input.input.channel,
          normalizedReply: responseDetectedAs === 'ok' ? 'OK' : 'HELP',
          providerMessageId: input.input.providerMessageId,
          providerReceivedAt: input.input.providerReceivedAt?.toISOString(),
        }),
      ),
    });
    if (!checkIn) {
      // Closed between the lookup and the guarded write (a cancellation or a backup contact's DONE): the
      // status stays as it is and the reply is only recorded (CB-006).
      await this.auditUnactionedReply(input.input, {
        entityType: 'receiver',
        entityId: input.receiverId,
        action: 'receiver.check_in_reply_ignored',
        metadata: {
          channel: input.input.channel,
          normalizedReply: input.normalizedReply,
          providerMessageId: input.input.providerMessageId,
          reason: 'check_in_closed',
        },
      });
      return null;
    }
    await this.checkInsRepository.markLatestSentAttemptResponded({
      checkInId: openCheckIn.id,
      completedAt: input.receivedAt,
    });
    await this.checkInsRepository.skipPendingAttemptsForCheckIn({
      checkInId: openCheckIn.id,
      completedAt: input.receivedAt,
      failureReason: 'superseded_by_response',
    });

    await this.auditService.append({
      entityType: 'check_in',
      entityId: openCheckIn.id,
      action: `check_in.responded_${responseDetectedAs}`,
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: input.receiverId,
        channel: input.input.channel,
        responseDetectedAs,
        providerMessageId: input.input.providerMessageId,
      },
      ipAddress: input.input.ipAddress,
      userAgent: input.input.userAgent,
    });

    if (responseDetectedAs === 'help') {
      await this.escalationsService?.escalateHelpResponse({
        receiverId: input.receiverId,
        checkInId: checkIn.id,
        sourceChannel: input.input.channel,
      });
    }

    return { action, checkIn };
  }

  private async handleBackupContactReply(input: {
    phoneHash: string;
    input: HandleInboundReceiverReplyInput;
    receivedAt: Date;
  }): Promise<HandleInboundReceiverReplyResult> {
    const backupContact = await this.backupContactsRepository?.findActiveByPhoneHash(input.phoneHash);
    if (!backupContact) {
      await this.auditUnactionedReply(input.input, {
        entityType: 'inbound_reply',
        entityId: UNATTRIBUTED_INBOUND_REPLY_ENTITY_ID,
        action: 'inbound_reply.unknown_sender',
        metadata: {
          channel: input.input.channel,
          providerMessageId: input.input.providerMessageId,
          senderHashPrefix: input.phoneHash.slice(0, SENDER_HASH_PREFIX_LENGTH),
          bodyLength: input.input.body.length,
        },
      });

      return { receiverId: '', action: 'unknown_sender' };
    }

    const normalizedReply = this.normalizeBackupContactReply(input.input.body);
    if (normalizedReply !== 'DONE') {
      await this.auditUnactionedReply(input.input, {
        entityType: 'backup_contact',
        entityId: backupContact.id,
        action: 'backup_contact.reply_unrecognised',
        metadata: {
          receiverId: backupContact.receiverId,
          channel: input.input.channel,
          normalizedReply,
          providerMessageId: input.input.providerMessageId,
          bodyLength: input.input.body.length,
        },
      });

      return {
        receiverId: backupContact.receiverId,
        backupContactId: backupContact.id,
        action: 'unrecognised_reply',
      };
    }

    const checkIn = await this.checkInsRepository.findLatestActionableForReceiver(backupContact.receiverId);
    if (!checkIn) {
      await this.auditUnactionedReply(input.input, {
        entityType: 'backup_contact',
        entityId: backupContact.id,
        action: 'backup_contact.reply_ignored',
        metadata: {
          receiverId: backupContact.receiverId,
          channel: input.input.channel,
          normalizedReply,
          providerMessageId: input.input.providerMessageId,
          reason: 'no_actionable_check_in',
        },
      });

      return {
        receiverId: backupContact.receiverId,
        backupContactId: backupContact.id,
        action: 'no_actionable_check_in',
      };
    }

    const resolvedCheckIn = await this.checkInsRepository.markResolvedByBackupContact({
      checkInId: checkIn.id,
      resolvedAt: input.receivedAt,
    });
    if (!resolvedCheckIn) {
      await this.auditUnactionedReply(input.input, {
        entityType: 'backup_contact',
        entityId: backupContact.id,
        action: 'backup_contact.reply_ignored',
        metadata: {
          receiverId: backupContact.receiverId,
          channel: input.input.channel,
          normalizedReply,
          providerMessageId: input.input.providerMessageId,
          reason: 'check_in_not_actionable',
        },
      });

      return {
        receiverId: backupContact.receiverId,
        backupContactId: backupContact.id,
        action: 'no_actionable_check_in',
      };
    }

    const resolutionTextStored = await this.storeBackupReplyOnCheckIn(resolvedCheckIn, input.input.body);

    await this.auditService.append({
      entityType: 'check_in',
      entityId: checkIn.id,
      action: 'check_in.resolved_by_backup',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: backupContact.receiverId,
        backupContactId: backupContact.id,
        channel: input.input.channel,
        normalizedReply,
        providerMessageId: input.input.providerMessageId,
        resolutionTextStored,
      },
      ipAddress: input.input.ipAddress,
      userAgent: input.input.userAgent,
    });

    const owner = await this.receiversRepository.findActiveById(backupContact.receiverId);
    if (owner) {
      await this.pushQuietUpdateToSender({
        userId: owner.userId,
        receiverId: owner.id,
        reason: 'backup_contact_done',
        checkInId: resolvedCheckIn.id,
      });
    }

    return {
      receiverId: backupContact.receiverId,
      backupContactId: backupContact.id,
      action: 'check_in_resolved_by_backup',
      checkInId: resolvedCheckIn.id,
      checkInStatus: resolvedCheckIn.status,
    };
  }

  /**
   * Keeps what the backup contact wrote on the check-in it closed: the note itself when none exists, else a
   * new line under the sender's own note. Encrypted like every other free text (CB-018).
   */
  private async storeBackupReplyOnCheckIn(checkIn: CheckInRecord, body: string): Promise<boolean> {
    const text = Array.from(body.trim()).slice(0, MAX_RESOLUTION_NOTE_LENGTH).join('');
    if (!text) {
      return false;
    }

    const entry = `${BACKUP_REPLY_NOTE_PREFIX}${text}`;
    const existing = checkIn.resolutionNote ? this.cryptoService.decrypt(checkIn.resolutionNote) : '';
    await this.receiversRepository.setCheckInResolutionNote({
      checkInId: checkIn.id,
      resolutionNote: this.cryptoService.encrypt(existing ? `${existing}\n${entry}` : entry),
    });

    return true;
  }
}
