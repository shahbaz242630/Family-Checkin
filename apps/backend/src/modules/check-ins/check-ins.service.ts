import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { CheckInReceiverCandidate, CheckInsRepository } from './check-ins.repository';
import { CHECK_INS_REPOSITORY } from './check-ins.tokens';
import type { VoiceCallerIdRepository } from './voice-caller-id.repository';

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

export interface ProcessCascadeAttemptsResult {
  sent: number;
  timedOut: number;
  failed: number;
  needsAttention: number;
  skipped: number;
}

export interface RecordVoiceProviderFailureInput {
  providerMessageId?: string;
  providerStatus?: string;
  answeredBy?: string;
}

export interface RecordVoiceProviderFailureResult {
  updated: boolean;
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
    @Optional()
    @Inject(BillingService)
    private readonly billingService?: Pick<BillingService, 'getBillingStatus'>,
    private readonly voiceCallerIds?: VoiceCallerIdRepository,
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
      if (!(await this.hasPaidAccess(receiver.userId))) {
        result.skipped += 1;
        continue;
      }

      const checkIn = await this.checkInsRepository.createPending({
        receiverId: receiver.id,
        scheduledAt: now,
      });
      result.created += 1;
      const attempts = await this.checkInsRepository.createAttempts(this.buildCascadeAttempts(receiver, checkIn.id, now));

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
      if (attempts[0]) {
        await this.checkInsRepository.markAttemptSent({
          attemptId: attempts[0].id,
          sentAt: now,
          providerMessageId: providerResult.providerId,
          providerStatus: providerResult.providerStatus,
        });
      }
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
        } else if (escalation?.status === CheckInStatus.FAILED) {
          result.failed += 1;
        } else {
          result.skipped += 1;
        }
      } catch {
        result.failed += 1;
      }
    }

    return result;
  }

  async processCascadeAttempts(): Promise<ProcessCascadeAttemptsResult> {
    const now = this.now();
    const result: ProcessCascadeAttemptsResult = { sent: 0, timedOut: 0, failed: 0, needsAttention: 0, skipped: 0 };

    for (const attempt of await this.checkInsRepository.findTimedOutSentAttempts({ now })) {
      if (!this.isAttemptTimedOut(attempt, now)) {
        continue;
      }

      await this.checkInsRepository.markAttemptTimedOut({ attemptId: attempt.id, completedAt: now });
      result.timedOut += 1;

      if (await this.sendNextPendingAttempt(attempt.checkIn.id, now)) {
        result.sent += 1;
      } else {
        await this.markCheckInNeedsAttention({
          checkInId: attempt.checkIn.id,
          receiverId: attempt.checkIn.receiverId,
        });
        result.needsAttention += 1;
      }
    }

    for (const attempt of await this.checkInsRepository.findDuePendingAttempts({ now })) {
      if (this.isClosed(attempt.checkIn.status)) {
        const skipped = await this.checkInsRepository.skipPendingAttemptsForCheckIn({
          checkInId: attempt.checkIn.id,
          completedAt: now,
          failureReason: 'cascade_closed',
        });
        result.skipped += skipped;
        continue;
      }

      try {
        await this.sendAttempt(attempt, now);
        result.sent += 1;
      } catch {
        await this.checkInsRepository.markAttemptFailed({
          attemptId: attempt.id,
          completedAt: now,
          failureReason: 'provider_send_failed',
        });
        result.failed += 1;

        if (await this.sendNextPendingAttempt(attempt.checkIn.id, now)) {
          result.sent += 1;
        } else {
          await this.checkInsRepository.markNeedsAttention({ checkInId: attempt.checkIn.id });
          result.needsAttention += 1;
        }
      }
    }

    return result;
  }

  async recordVoiceProviderFailure(input: RecordVoiceProviderFailureInput): Promise<RecordVoiceProviderFailureResult> {
    const providerMessageId = input.providerMessageId?.trim();
    const failureReason = this.voiceProviderFailureReason(input);
    const providerStatus = input.providerStatus ?? input.answeredBy;
    if (!providerMessageId || !failureReason || !providerStatus) {
      return { updated: false };
    }

    const attempt = await this.checkInsRepository.markSentAttemptProviderFailure({
      providerMessageId,
      completedAt: this.now(),
      providerStatus,
      failureReason,
    });

    if (attempt && !(await this.hasPendingAttempts(attempt.checkInId))) {
      const checkIn = await this.checkInsRepository.findById(attempt.checkInId);
      await this.markCheckInNeedsAttention({
        checkInId: attempt.checkInId,
        receiverId: checkIn?.receiverId ?? attempt.checkInId,
      });
    }

    return { updated: attempt !== null };
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

  private async hasPaidAccess(userId: string): Promise<boolean> {
    return (await this.billingService?.getBillingStatus(userId))?.entitled ?? false;
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
      }, await this.voiceCallOptions(receiver.id, receiver.countryCode));

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

  private buildCascadeAttempts(
    receiver: CheckInReceiverCandidate,
    checkInId: string,
    scheduledAt: Date,
  ): Array<{ checkInId: string; attemptNumber: number; channel: Channel; scheduledAt: Date }> {
    if (receiver.techProfile === TechProfile.VOICE_ONLY || receiver.techProfile === TechProfile.LANDLINE) {
      return [0, 15, 45].map((offsetMinutes, index) => ({
        checkInId,
        attemptNumber: index + 1,
        channel: Channel.VOICE,
        scheduledAt: new Date(scheduledAt.getTime() + offsetMinutes * 60 * 1000),
      }));
    }

    const channels =
      [receiver.primaryChannel, ...(receiver.fallbackChannels ?? [])].filter(
        (channel, index, all) => all.indexOf(channel) === index,
      );
    const offsets = channels.map((channel, index) => {
      if (index === 0) {
        return 0;
      }
      const previous = channels[index - 1];
      return previous === Channel.WHATSAPP ? 15 : index === 1 ? 30 : 45;
    });

    return channels.map((channel, index) => ({
      checkInId,
      attemptNumber: index + 1,
      channel,
      scheduledAt: new Date(scheduledAt.getTime() + (offsets[index] ?? 0) * 60 * 1000),
    }));
  }

  private async sendAttempt(attempt: Awaited<ReturnType<CheckInsRepository['findDuePendingAttempts']>>[number], now: Date): Promise<void> {
    const to = this.cryptoService.decrypt(attempt.checkIn.receiverPhoneEncrypted);
    const result =
      attempt.channel === Channel.VOICE
        ? await this.channelRouter.makeVoiceCall(Channel.VOICE, to, {
            scriptKey: 'checkin_daily_voice',
            language: attempt.checkIn.receiverLanguage,
            variables: {},
          }, await this.voiceCallOptions(attempt.checkIn.receiverId, attempt.checkIn.receiverCountryCode))
        : await this.channelRouter.sendMessage(attempt.channel, to, {
            templateKey: 'checkin_daily',
            language: attempt.checkIn.receiverLanguage,
            variables: {},
          });

    await this.checkInsRepository.markAttemptSent({
      attemptId: attempt.id,
      sentAt: now,
      providerMessageId: 'providerMessageId' in result ? result.providerMessageId : result.providerCallId,
      providerStatus: result.providerStatus,
    });
    await this.checkInsRepository.markSent({
      checkInId: attempt.checkIn.id,
      channel: attempt.channel,
      sentAt: now,
      providerMessageId: 'providerMessageId' in result ? result.providerMessageId : result.providerCallId,
      providerStatus: result.providerStatus,
    });
  }

  private async sendNextPendingAttempt(checkInId: string, now: Date): Promise<boolean> {
    const next = (await this.checkInsRepository.findDuePendingAttempts({ now: new Date('9999-12-31T23:59:59.999Z') })).find(
      (attempt) => attempt.checkIn.id === checkInId,
    );
    if (!next) {
      return false;
    }

    await this.sendAttempt(next, now);
    return true;
  }

  private async hasPendingAttempts(checkInId: string): Promise<boolean> {
    return (await this.checkInsRepository.findDuePendingAttempts({ now: new Date('9999-12-31T23:59:59.999Z') })).some(
      (attempt) => attempt.checkIn.id === checkInId,
    );
  }

  private async markCheckInNeedsAttention(input: { checkInId: string; receiverId: string }): Promise<void> {
    await this.checkInsRepository.markNeedsAttention({ checkInId: input.checkInId });
    await this.auditService.append({
      entityType: 'check_in',
      entityId: input.checkInId,
      action: 'check_in.needs_attention',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: input.receiverId,
        reason: 'cascade_exhausted',
      },
    });
  }

  private async voiceCallOptions(receiverId: string, countryCode: string): Promise<{ fromNumber: string } | undefined> {
    const fromNumber = await this.voiceCallerIds?.resolveForReceiver({ receiverId, countryCode });
    return fromNumber ? { fromNumber } : undefined;
  }

  private isAttemptTimedOut(attempt: { channel: Channel; sentAt?: Date }, now: Date): boolean {
    if (!attempt.sentAt) {
      return false;
    }
    const windowMinutes = attempt.channel === Channel.WHATSAPP ? 15 : 30;
    return attempt.sentAt.getTime() + windowMinutes * 60 * 1000 <= now.getTime();
  }

  private voiceProviderFailureReason(input: RecordVoiceProviderFailureInput): string | null {
    const status = input.providerStatus?.trim().toLowerCase();
    if (status && ['busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
      return `twilio_status_${status}`;
    }

    const answeredBy = input.answeredBy?.trim().toLowerCase();
    if (answeredBy && answeredBy !== 'human') {
      return `twilio_answered_by_${answeredBy}`;
    }

    return null;
  }

  private isClosed(status: CheckInStatus): boolean {
    const terminalStatuses: CheckInStatus[] = [
      CheckInStatus.RESPONDED_OK,
      CheckInStatus.RESPONDED_HELP,
      CheckInStatus.ESCALATED,
      CheckInStatus.RESOLVED,
      CheckInStatus.FAILED,
      CheckInStatus.SKIPPED,
    ];

    return terminalStatuses.includes(status);
  }
}
