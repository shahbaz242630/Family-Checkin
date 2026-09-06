import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { renderingAuditMetadata, type MessageRendering } from '../channels/message-catalog.service';
import { NEUTRAL_RECEIVER_GREETING_NAME, NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import { EscalationsService } from '../escalations/escalations.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { CheckInAlreadyScheduledError } from './check-ins.repository';
import type {
  CheckInAttemptRecord,
  CheckInAttemptWithCheckInRecord,
  CheckInReceiverCandidate,
  CheckInRecord,
  CheckInsRepository,
} from './check-ins.repository';
import { CHECK_INS_REPOSITORY } from './check-ins.tokens';
import type { VoiceCallerIdRepository } from './voice-caller-id.repository';

export interface SendDueCheckInsResult {
  created: number;
  sent: number;
  skipped: number;
  /** Receivers whose schedule could not be evaluated plus receivers whose first send threw (CB-004). */
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

/** Why a receiver's open check-ins are being cancelled; stored on the skipped attempts and audited (CB-008). */
export type CancelOpenCheckInsReason = 'receiver_opted_out' | 'abuse_reported' | 'receiver_paused' | 'receiver_deleted';

export interface CancelOpenCheckInsInput {
  receiverId: string;
  reason: CancelOpenCheckInsReason;
}

export interface CancelOpenCheckInsResult {
  cancelled: number;
  skippedAttempts: number;
}

interface CheckInRef {
  checkInId: string;
  receiverId: string;
}

const PROVIDER_SEND_FAILED = 'provider_send_failed';
const CASCADE_EXHAUSTED = 'cascade_exhausted';
/** Message templates for a check-in's first attempt and for every later attempt of the same check-in (CB-010). */
const CHECK_IN_FIRST_ATTEMPT_TEMPLATE = 'checkin_daily';
const CHECK_IN_LATER_ATTEMPT_TEMPLATE = 'checkin_retry';
/** Voice attempts play the same script whatever their position in the cascade. */
const CHECK_IN_VOICE_SCRIPT = 'checkin_daily_voice';

@Injectable()
export class CheckInsService {
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
    private readonly escalationsService?: Pick<EscalationsService, 'notifySenderOfMissedCheckIn'>,
    private readonly now: () => Date = () => new Date(),
    @Optional()
    @Inject(BillingService)
    private readonly billingService?: Pick<BillingService, 'getBillingStatus'>,
    private readonly voiceCallerIds?: VoiceCallerIdRepository,
  ) {}

  async sendDueCheckIns(): Promise<SendDueCheckInsResult> {
    const now = this.now();
    const due = await this.checkInsRepository.findReceiversDueForCheckIn(now);
    const result: SendDueCheckInsResult = { created: 0, sent: 0, skipped: 0, failed: 0 };

    for (const invalid of due.skipped) {
      result.failed += 1;
      // Audited once per schedule version, not once per tick: the first sighting stamps the receiver and only
      // that stamp write audits (CB-069). The stamp is cleared below once the schedule evaluates again.
      if (!(await this.stampScheduleInvalid(invalid.receiverId, now))) {
        continue;
      }
      await this.auditService.append({
        entityType: 'receiver',
        entityId: invalid.receiverId,
        action: 'check_in.schedule_invalid',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: invalid.receiverId,
          reason: invalid.reason,
        },
      });
    }
    if (due.recovered?.length) {
      await this.checkInsRepository.clearScheduleInvalid?.({ receiverIds: due.recovered });
    }

    for (const receiver of due.candidates) {
      if (!this.isEligible(receiver, now)) {
        result.skipped += 1;
        continue;
      }
      if (!(await this.hasPaidAccess(receiver.userId))) {
        result.skipped += 1;
        continue;
      }

      let checkIn: CheckInRecord;
      try {
        checkIn = await this.checkInsRepository.createPending({
          receiverId: receiver.id,
          scheduledAt: now,
          scheduledLocalDate: receiver.scheduledLocalDate,
        });
      } catch (error) {
        if (error instanceof CheckInAlreadyScheduledError) {
          // An overlapping tick created this receiver's check-in for the same local day between the repository's
          // lookup and this insert; the unique index made it lose the race, so it neither sends nor audits (CB-013).
          result.skipped += 1;
          continue;
        }
        throw error;
      }
      result.created += 1;
      const [firstAttempt] = await this.checkInsRepository.createAttempts(
        this.buildCascadeAttempts(receiver, checkIn.id, now),
      );

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

      if (await this.sendFirstAttempt(receiver, checkIn.id, firstAttempt, now)) {
        result.sent += 1;
      } else {
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

      // Each attempt is isolated so one provider or database error cannot stop the rest of the tick (CB-004).
      try {
        if (!(await this.checkInsRepository.markAttemptTimedOut({ attemptId: attempt.id, completedAt: now }))) {
          // A reply or a provider callback closed this attempt between the query and the write.
          continue;
        }
        result.timedOut += 1;
        await this.advanceCascade(this.toCheckInRef(attempt), now, result);
      } catch {
        result.failed += 1;
      }
    }

    for (const attempt of await this.checkInsRepository.findDuePendingAttempts({ now })) {
      try {
        if (this.isClosed(attempt.checkIn.status)) {
          result.skipped += await this.checkInsRepository.skipPendingAttemptsForCheckIn({
            checkInId: attempt.checkIn.id,
            completedAt: now,
            failureReason: 'cascade_closed',
          });
          continue;
        }

        if (await this.trySendAttempt(attempt, now)) {
          result.sent += 1;
          continue;
        }
        result.failed += 1;
        // A later attempt that is already due is still in this list and goes out in its own iteration.
        if (await this.flagIfExhausted(this.toCheckInRef(attempt))) {
          result.needsAttention += 1;
        }
      } catch {
        result.failed += 1;
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
    if (!attempt) {
      return { updated: false };
    }

    // A no-answer or machine-answer callback can land after the receiver already replied by another channel
    // (CB-006): the attempt is recorded as failed, but a closed check-in is never reopened or flagged.
    const checkIn = await this.checkInsRepository.findById(attempt.checkInId);
    if (checkIn && !this.isClosed(checkIn.status)) {
      await this.flagIfExhausted({ checkInId: checkIn.id, receiverId: checkIn.receiverId });
    }

    return { updated: true };
  }

  /**
   * Skips every pending attempt and closes every open check-in of a receiver, so a STOP, a REPORT, a pause or a
   * deletion stops the cascade at once instead of after the next message goes out (CB-008). Attempts already
   * with the provider stay SENT until they time out; a closed check-in is never reopened by them.
   */
  async cancelOpenCheckInsForReceiver(input: CancelOpenCheckInsInput): Promise<CancelOpenCheckInsResult> {
    const now = this.now();
    const result: CancelOpenCheckInsResult = { cancelled: 0, skippedAttempts: 0 };

    for (const checkIn of await this.checkInsRepository.findOpenForReceiver(input.receiverId)) {
      const skippedAttempts = await this.checkInsRepository.skipPendingAttemptsForCheckIn({
        checkInId: checkIn.id,
        completedAt: now,
        failureReason: input.reason,
      });
      result.skippedAttempts += skippedAttempts;

      if (!(await this.checkInsRepository.markCancelled({ checkInId: checkIn.id }))) {
        continue;
      }
      result.cancelled += 1;
      await this.auditService.append({
        entityType: 'check_in',
        entityId: checkIn.id,
        action: 'check_in.cancelled',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: input.reason,
          skippedAttempts,
        },
      });
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

  private async hasPaidAccess(userId: string): Promise<boolean> {
    return (await this.billingService?.getBillingStatus(userId))?.entitled ?? false;
  }

  /** True when this tick is the first to see the receiver's schedule as invalid; a repository without the stamp audits every tick. */
  private async stampScheduleInvalid(receiverId: string, seenAt: Date): Promise<boolean> {
    return (await this.checkInsRepository.markScheduleInvalid?.({ receiverId, seenAt })) ?? true;
  }

  /**
   * First attempt of a new check-in. A provider that throws (Twilio 21211, a stalled socket, a bad row) marks the
   * attempt FAILED and returns false; the receiver's fallback attempts stay scheduled and the loop continues with
   * the next receiver (CB-004).
   */
  private async sendFirstAttempt(
    receiver: CheckInReceiverCandidate,
    checkInId: string,
    attempt: CheckInAttemptRecord | undefined,
    now: Date,
  ): Promise<boolean> {
    let providerResult: { providerId: string; providerStatus: string; rendering?: MessageRendering };
    try {
      providerResult = await this.sendInitialCheckIn(receiver);
    } catch {
      if (attempt) {
        await this.checkInsRepository.markAttemptFailed({
          attemptId: attempt.id,
          completedAt: now,
          failureReason: PROVIDER_SEND_FAILED,
        });
      }
      await this.auditAttemptFailed({
        checkInId,
        receiverId: receiver.id,
        channel: receiver.primaryChannel,
        attemptNumber: attempt?.attemptNumber ?? 1,
      });
      await this.flagIfExhausted({ checkInId, receiverId: receiver.id });
      return false;
    }

    if (attempt) {
      await this.checkInsRepository.markAttemptSent({
        attemptId: attempt.id,
        sentAt: now,
        providerMessageId: providerResult.providerId,
        providerStatus: providerResult.providerStatus,
      });
    }
    await this.checkInsRepository.markSent({
      checkInId,
      channel: receiver.primaryChannel,
      sentAt: now,
      providerMessageId: providerResult.providerId,
      providerStatus: providerResult.providerStatus,
    });

    await this.auditService.append({
      entityType: 'check_in',
      entityId: checkInId,
      action: 'check_in.sent',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: receiver.id,
        channel: receiver.primaryChannel,
        providerStatus: providerResult.providerStatus,
        ...renderingAuditMetadata(providerResult.rendering),
      },
    });

    return true;
  }

  private async sendInitialCheckIn(
    receiver: CheckInReceiverCandidate,
  ): Promise<{ providerId: string; providerStatus: string; rendering?: MessageRendering }> {
    const to = this.cryptoService.decrypt(receiver.phoneEncrypted);

    if (receiver.primaryChannel === Channel.VOICE) {
      const result = await this.channelRouter.makeVoiceCall(
        Channel.VOICE,
        to,
        {
          scriptKey: CHECK_IN_VOICE_SCRIPT,
          language: receiver.language,
          variables: {},
        },
        await this.voiceCallOptions(receiver.id, receiver.countryCode),
      );

      return {
        providerId: result.providerCallId,
        providerStatus: result.providerStatus,
      };
    }

    const result = await this.channelRouter.sendMessage(receiver.primaryChannel, to, {
      templateKey: CHECK_IN_FIRST_ATTEMPT_TEMPLATE,
      language: receiver.language,
      variables: this.checkInMessageVariables(receiver.nameEncrypted, receiver.personalNoteEncrypted),
    });

    return {
      providerId: result.providerMessageId,
      providerStatus: result.providerStatus,
      rendering: result.rendering,
    };
  }

  /** Receiver-facing copy names the receiver, the sender (neutral until sender names are stored) and the note. */
  private checkInMessageVariables(
    nameEncrypted: string | undefined,
    personalNoteEncrypted: string | undefined,
  ): Record<string, string> {
    const personalNote = personalNoteEncrypted ? this.cryptoService.decrypt(personalNoteEncrypted) : undefined;

    return {
      receiverName: nameEncrypted ? this.cryptoService.decrypt(nameEncrypted) : NEUTRAL_RECEIVER_GREETING_NAME,
      senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME,
      ...(personalNote ? { personalNote } : {}),
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

    const channels = [receiver.primaryChannel, ...(receiver.fallbackChannels ?? [])].filter(
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

  /** Sends one due attempt; a throwing provider marks it FAILED and returns false instead of ending the tick (CB-004). */
  private async trySendAttempt(attempt: CheckInAttemptWithCheckInRecord, now: Date): Promise<boolean> {
    try {
      await this.sendAttempt(attempt, now);
    } catch {
      await this.checkInsRepository.markAttemptFailed({
        attemptId: attempt.id,
        completedAt: now,
        failureReason: PROVIDER_SEND_FAILED,
      });
      await this.auditAttemptFailed({
        checkInId: attempt.checkIn.id,
        receiverId: attempt.checkIn.receiverId,
        channel: attempt.channel,
        attemptNumber: attempt.attemptNumber,
      });
      return false;
    }

    return true;
  }

  private async sendAttempt(
    attempt: Awaited<ReturnType<CheckInsRepository['findDuePendingAttempts']>>[number],
    now: Date,
  ): Promise<void> {
    const to = this.cryptoService.decrypt(attempt.checkIn.receiverPhoneEncrypted);
    const result =
      attempt.channel === Channel.VOICE
        ? await this.channelRouter.makeVoiceCall(
            Channel.VOICE,
            to,
            {
              scriptKey: CHECK_IN_VOICE_SCRIPT,
              language: attempt.checkIn.receiverLanguage,
              variables: {},
            },
            await this.voiceCallOptions(attempt.checkIn.receiverId, attempt.checkIn.receiverCountryCode),
          )
        : await this.channelRouter.sendMessage(attempt.channel, to, {
            // Attempt 2 onwards tells the receiver we have not heard back yet (CB-010); attempt 1 of a check-in
            // that reaches the cascade unsent (a sender try-later row) still reads as a first check-in.
            templateKey: attempt.attemptNumber > 1 ? CHECK_IN_LATER_ATTEMPT_TEMPLATE : CHECK_IN_FIRST_ATTEMPT_TEMPLATE,
            language: attempt.checkIn.receiverLanguage,
            variables: this.checkInMessageVariables(
              attempt.checkIn.receiverNameEncrypted,
              attempt.checkIn.receiverPersonalNoteEncrypted,
            ),
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

  /** After an attempt ends unanswered: send the next attempt if it is due, or flag the check-in once none remain. */
  private async advanceCascade(checkIn: CheckInRef, now: Date, result: ProcessCascadeAttemptsResult): Promise<void> {
    const next = (await this.checkInsRepository.findDuePendingAttempts({ now })).find(
      (attempt) => attempt.checkIn.id === checkIn.checkInId,
    );
    if (next && this.isClosed(next.checkIn.status)) {
      // A reply, a backup contact or a cancellation closed the check-in first: never reopen it (CB-006).
      result.skipped += await this.checkInsRepository.skipPendingAttemptsForCheckIn({
        checkInId: checkIn.checkInId,
        completedAt: now,
        failureReason: 'cascade_closed',
      });
      return;
    }
    if (next) {
      if (await this.trySendAttempt(next, now)) {
        result.sent += 1;
        return;
      }
      result.failed += 1;
    }
    if (await this.flagIfExhausted(checkIn)) {
      result.needsAttention += 1;
    }
  }

  private async hasPendingAttempts(checkInId: string): Promise<boolean> {
    return (await this.checkInsRepository.findDuePendingAttempts({ now: new Date('9999-12-31T23:59:59.999Z') })).some(
      (attempt) => attempt.checkIn.id === checkInId,
    );
  }

  /** Flags the check-in NEEDS_ATTENTION when no attempt is left; true only when this call made the transition. */
  private async flagIfExhausted(checkIn: CheckInRef): Promise<boolean> {
    if (await this.hasPendingAttempts(checkIn.checkInId)) {
      return false;
    }

    return this.markCheckInNeedsAttention(checkIn);
  }

  /**
   * PENDING/SENT -> NEEDS_ATTENTION plus the sender siren (CB-005). The status guard makes this idempotent: a
   * second timed-out attempt, a replayed provider callback or a re-run tick finds the check-in already flagged
   * (or closed) and neither audits nor notifies again.
   */
  private async markCheckInNeedsAttention(input: CheckInRef): Promise<boolean> {
    if (!(await this.checkInsRepository.markNeedsAttention({ checkInId: input.checkInId }))) {
      return false;
    }

    await this.auditService.append({
      entityType: 'check_in',
      entityId: input.checkInId,
      action: 'check_in.needs_attention',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: input.receiverId,
        reason: CASCADE_EXHAUSTED,
      },
    });

    try {
      await this.escalationsService?.notifySenderOfMissedCheckIn({
        receiverId: input.receiverId,
        checkInId: input.checkInId,
      });
    } catch {
      // Push and voice failures are audited inside EscalationsService; this covers a failure before either
      // (for example the owner lookup) so the cron tick still completes for every other receiver.
      await this.auditService.append({
        entityType: 'check_in',
        entityId: input.checkInId,
        action: 'check_in.sender_notify_failed',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: input.receiverId,
          reason: CASCADE_EXHAUSTED,
        },
      });
    }

    return true;
  }

  private async auditAttemptFailed(input: CheckInRef & { channel: Channel; attemptNumber: number }): Promise<void> {
    await this.auditService.append({
      entityType: 'check_in',
      entityId: input.checkInId,
      action: 'check_in.attempt_failed',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: input.receiverId,
        channel: input.channel,
        attemptNumber: input.attemptNumber,
        failureReason: PROVIDER_SEND_FAILED,
      },
    });
  }

  private toCheckInRef(attempt: CheckInAttemptWithCheckInRecord): CheckInRef {
    return { checkInId: attempt.checkIn.id, receiverId: attempt.checkIn.receiverId };
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
