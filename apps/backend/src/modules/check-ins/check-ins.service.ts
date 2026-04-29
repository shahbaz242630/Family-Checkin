import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, ConsentStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { CheckInReceiverCandidate, CheckInsRepository } from './check-ins.repository';
import { CHECK_INS_REPOSITORY } from './check-ins.tokens';

export interface SendDueCheckInsResult {
  created: number;
  sent: number;
  skipped: number;
}

export interface EscalateOverdueCheckInsResult {
  checked: number;
  escalated: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class CheckInsService {
  private static readonly defaultResponseWindowMinutes = 30;

  constructor(
    @Inject(CHECK_INS_REPOSITORY) private readonly checkInsRepository: CheckInsRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(ChannelRouterService)
    private readonly channelRouter: ChannelRouterService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional()
    @Inject(EscalationsService)
    private readonly escalationsService?: Pick<EscalationsService, 'escalateMissedCheckIn'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendDueCheckIns(): Promise<SendDueCheckInsResult> {
    const now = this.now();
    const receivers = await this.checkInsRepository.findReceiversDueForCheckIn(now);
    const result: SendDueCheckInsResult = { created: 0, sent: 0, skipped: 0 };

    for (const receiver of receivers) {
      if (!this.isEligible(receiver, now)) {
        result.skipped += 1;
        continue;
      }

      const checkIn = await this.checkInsRepository.createPending({
        receiverId: receiver.id,
        scheduledAt: now,
      });
      result.created += 1;

      await this.auditService.append({
        entityType: 'check_in',
        entityId: checkIn.id,
        action: 'check_in.created',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: receiver.id,
          scheduleFrequency: receiver.scheduleFrequency,
        },
      });

      const providerResult = await this.sendInitialCheckIn(receiver);
      await this.checkInsRepository.markSent({
        checkInId: checkIn.id,
        channel: receiver.primaryChannel,
        sentAt: now,
        providerMessageId: providerResult.providerId,
        providerStatus: providerResult.providerStatus,
      });
      result.sent += 1;

      await this.auditService.append({
        entityType: 'check_in',
        entityId: checkIn.id,
        action: 'check_in.sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: receiver.id,
          channel: receiver.primaryChannel,
          providerStatus: providerResult.providerStatus,
        },
      });
    }

    return result;
  }

  async escalateOverdueCheckIns(
    responseWindowMinutes = CheckInsService.defaultResponseWindowMinutes,
  ): Promise<EscalateOverdueCheckInsResult> {
    const now = this.now();
    const overdueBefore = new Date(now.getTime() - responseWindowMinutes * 60 * 1000);
    const checkIns = await this.checkInsRepository.findOverdueSentCheckIns({ overdueBefore });
    const result: EscalateOverdueCheckInsResult = { checked: checkIns.length, escalated: 0, skipped: 0, failed: 0 };

    for (const checkIn of checkIns) {
      if (!checkIn.sentAt) {
        result.skipped += 1;
        continue;
      }

      try {
        const escalation = await this.escalationsService?.escalateMissedCheckIn({
          receiverId: checkIn.receiverId,
          checkInId: checkIn.id,
          sentAt: checkIn.sentAt,
          responseWindowMinutes,
        });

        if (escalation?.status === CheckInStatus.ESCALATED) {
          result.escalated += 1;
        } else {
          result.skipped += 1;
        }
      } catch {
        result.failed += 1;
      }
    }

    return result;
  }

  private isEligible(receiver: CheckInReceiverCandidate, now: Date): boolean {
    if (receiver.consentStatus !== ConsentStatus.GRANTED) {
      return false;
    }
    if (receiver.deletedAt) {
      return false;
    }
    if (receiver.pausedUntil && receiver.pausedUntil > now) {
      return false;
    }

    return true;
  }

  private async sendInitialCheckIn(
    receiver: CheckInReceiverCandidate,
  ): Promise<{ providerId: string; providerStatus: string }> {
    const to = this.cryptoService.decrypt(receiver.phoneEncrypted);

    if (receiver.primaryChannel === Channel.VOICE) {
      const result = await this.channelRouter.makeVoiceCall(Channel.VOICE, to, {
        scriptKey: 'checkin_daily_voice',
        language: receiver.language,
        variables: {},
      });

      return {
        providerId: result.providerCallId,
        providerStatus: result.providerStatus,
      };
    }

    const result = await this.channelRouter.sendMessage(receiver.primaryChannel, to, {
      templateKey: 'checkin_daily',
      language: receiver.language,
      variables: {},
    });

    return {
      providerId: result.providerMessageId,
      providerStatus: result.providerStatus,
    };
  }
}
