import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Channel } from '@prisma/client';
import type { AuditMetadata } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import type { BackupContactsRepository } from '../backup-contacts/backup-contacts.repository';
import { BACKUP_CONTACTS_REPOSITORY } from '../backup-contacts/backup-contacts.tokens';
import type { CheckInRecord, CheckInsRepository } from '../check-ins/check-ins.repository';
import { CHECK_INS_REPOSITORY } from '../check-ins/check-ins.tokens';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import { ABUSE_REVIEW_PAUSE_REASON } from './abuse-review-pause';
import type { ReceiversRepository } from './receivers.repository';
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

/**
 * audit_logs.entity_id is a UUID column, so replies that cannot be attributed to any receiver or backup contact
 * are grouped under entityType 'inbound_reply' with this nil-UUID entity id.
 */
const UNATTRIBUTED_INBOUND_REPLY_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const SENDER_HASH_PREFIX_LENGTH = 12;

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
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handleInboundReply(input: HandleInboundReceiverReplyInput): Promise<HandleInboundReceiverReplyResult> {
    const receivedAt = this.now();
    const normalizedPhone = this.tryNormalizePhone(input.fromPhone);
    if (!normalizedPhone) {
      return this.handleInvalidSender(input);
    }

    const phoneHash = this.cryptoService.hashForLookup(normalizedPhone);
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

    const updatedReceiver = await this.receiversRepository.updateConsentResponse({
      receiverId: receiver.id,
      consentStatus: transition.consentStatus,
      consentGrantedAt: transition.consentStatus === ConsentStatus.GRANTED ? receivedAt : undefined,
      consentRevokedAt: transition.consentStatus === ConsentStatus.REVOKED ? receivedAt : undefined,
      consentTranscript: this.cryptoService.encrypt(
        JSON.stringify({
          receivedAt: receivedAt.toISOString(),
          channel: input.channel,
          normalizedReply,
          providerMessageId: input.providerMessageId,
          providerReceivedAt: input.providerReceivedAt?.toISOString(),
        }),
      ),
    });

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
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

    if (normalizedReply === 'STOP') {
      await this.receiversRepository.upsertOptOutCooldown({
        receiverId: receiver.id,
        optOutAt: receivedAt,
        cooldownUntil: this.addDays(receivedAt, 7),
        optOutChannel: input.channel,
        optOutKeyword: normalizedReply,
      });
    }

    return {
      receiverId: updatedReceiver.id,
      action: transition.action,
      consentStatus: updatedReceiver.consentStatus,
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

  private normalizeReceiverReply(body: string): 'YES' | 'NO' | 'STOP' | 'REPORT' | 'UNKNOWN' {
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

  private toConsentTransition(reply: 'YES' | 'NO' | 'STOP' | 'REPORT' | 'UNKNOWN'): {
    action: 'consent_granted' | 'consent_declined' | 'consent_revoked';
    consentStatus: ConsentStatus;
  } | null {
    if (reply === 'YES') {
      return {
        action: 'consent_granted',
        consentStatus: ConsentStatus.GRANTED,
      };
    }

    if (reply === 'NO') {
      return {
        action: 'consent_declined',
        consentStatus: ConsentStatus.DECLINED,
      };
    }

    if (reply === 'STOP') {
      return {
        action: 'consent_revoked',
        consentStatus: ConsentStatus.REVOKED,
      };
    }

    return null;
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
    // CB-008: cancel in-flight attempts here (CheckInsService.cancelOpenCheckInsForReceiver) so a receiver paused
    // for review receives nothing further from a cascade that is already running today.

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
      },
      ipAddress: input.input.ipAddress,
      userAgent: input.input.userAgent,
    });

    return {
      receiverId: backupContact.receiverId,
      backupContactId: backupContact.id,
      action: 'check_in_resolved_by_backup',
      checkInId: resolvedCheckIn.id,
      checkInStatus: resolvedCheckIn.status,
    };
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
