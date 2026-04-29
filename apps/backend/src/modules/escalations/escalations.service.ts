import { Inject, Injectable } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { EscalationsRepository } from './escalations.repository';
import { ESCALATIONS_REPOSITORY } from './escalations.tokens';

export interface EscalateHelpResponseInput {
  receiverId: string;
  checkInId: string;
  sourceChannel: Channel;
}

export interface EscalateHelpResponseResult {
  checkInId: string;
  status: CheckInStatus;
  attempted: number;
  succeeded: number;
  failed: number;
}

@Injectable()
export class EscalationsService {
  constructor(
    @Inject(ESCALATIONS_REPOSITORY) private readonly escalationsRepository: EscalationsRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(ChannelRouterService)
    private readonly channelRouter: ChannelRouterService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async escalateHelpResponse(input: EscalateHelpResponseInput): Promise<EscalateHelpResponseResult> {
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
          sourceChannel: input.sourceChannel,
        },
      });

      return {
        checkInId: input.checkInId,
        status: CheckInStatus.RESPONDED_HELP,
        attempted: 0,
        succeeded: 0,
        failed: 0,
      };
    }

    let succeeded = 0;
    let failed = 0;

    for (const [index, contact] of backupContacts.entries()) {
      const attemptNumber = index + 1;
      const startedAt = this.now();

      try {
        const providerResult = await this.channelRouter.sendMessage(Channel.SMS, this.cryptoService.decrypt(contact.phoneEncrypted), {
          templateKey: 'backup_contact_help_alert',
          language: 'en',
          variables: {
            checkInId: input.checkInId,
            receiverId: input.receiverId,
          },
        });
        const event = await this.escalationsRepository.createEvent({
          checkInId: input.checkInId,
          attemptNumber,
          channel: Channel.SMS,
          startedAt,
          completedAt: this.now(),
          result: EscalationResult.SUCCESS,
          backupAlertedAt: providerResult.acceptedAt,
        });
        succeeded += 1;

        await this.auditService.append({
          entityType: 'escalation_event',
          entityId: event.id,
          action: 'escalation.backup_contact_alerted',
          actorType: ActorType.SYSTEM,
          metadata: {
            receiverId: input.receiverId,
            checkInId: input.checkInId,
            backupContactId: contact.id,
            channel: Channel.SMS,
            attemptNumber,
            providerStatus: providerResult.providerStatus,
            sourceChannel: input.sourceChannel,
          },
        });
      } catch {
        const event = await this.escalationsRepository.createEvent({
          checkInId: input.checkInId,
          attemptNumber,
          channel: Channel.SMS,
          startedAt,
          completedAt: this.now(),
          result: EscalationResult.ERROR,
          errorDetails: 'provider_send_failed',
        });
        failed += 1;

        await this.auditService.append({
          entityType: 'escalation_event',
          entityId: event.id,
          action: 'escalation.backup_contact_failed',
          actorType: ActorType.SYSTEM,
          metadata: {
            receiverId: input.receiverId,
            checkInId: input.checkInId,
            backupContactId: contact.id,
            channel: Channel.SMS,
            attemptNumber,
            sourceChannel: input.sourceChannel,
          },
        });
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
    }

    return {
      checkInId: input.checkInId,
      status: succeeded > 0 ? CheckInStatus.ESCALATED : CheckInStatus.RESPONDED_HELP,
      attempted: backupContacts.length,
      succeeded,
      failed,
    };
  }
}
