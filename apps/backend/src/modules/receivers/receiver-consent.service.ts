import { Inject, Injectable, Optional } from '@nestjs/common';
import { ActorType, Channel, ConsentStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { renderingAuditMetadata } from '../channels/message-catalog.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import {
  addDays,
  auditSafeErrorMessage,
  CONSENT_REQUEST_MIN_INTERVAL_DAYS,
  ConsentNotPendingError,
  ConsentResendLimitError,
  OptOutCooldownError,
} from './receiver-policy';
import type { ReceiverRecord, ReceiversRepository } from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

export interface RequestReceiverConsentInput {
  receiver: ReceiverRecord;
  actorUserId: string;
  senderDisplayName: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResendReceiverConsentInput {
  userId: string;
  receiverId: string;
  senderDisplayName: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResendReceiverConsentResult {
  receiver: ReceiverRecord;
  /** False when the provider refused the send; `consentRequestedAt` is then left as it was. */
  sent: boolean;
}

interface ConsentSendOutcome {
  templateKey: string;
  providerStatus: string;
  transcript: Record<string, string | boolean | undefined>;
}

type ConsentSendResult = { ok: true; outcome: ConsentSendOutcome } | { ok: false; templateKey: string; error: unknown };

@Injectable()
export class ReceiverConsentService {
  constructor(
    @Inject(RECEIVERS_REPOSITORY) private readonly receiversRepository: ReceiversRepository,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(ChannelRouterService)
    private readonly channelRouter: ChannelRouterService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * First consent invitation, right after the receiver is created. A provider failure is audited and leaves
   * `consentRequestedAt` unset, so the sender can `resendConsent` instead of being stuck with a receiver that
   * looks invited but never was (CB-009).
   */
  async requestConsent(input: RequestReceiverConsentInput): Promise<ReceiverRecord> {
    if (input.receiver.consentRequestedAt) {
      throw new Error('Receiver consent has already been requested');
    }

    const requestedAt = this.now();
    const sent = await this.trySendConsentRequest(input.receiver, input.senderDisplayName);
    if (!sent.ok) {
      await this.auditService.append({
        entityType: 'receiver',
        entityId: input.receiver.id,
        action: 'receiver.consent_request_failed',
        actorType: ActorType.USER,
        actorId: input.actorUserId,
        metadata: {
          channel: input.receiver.primaryChannel,
          templateKey: sent.templateKey,
          error: auditSafeErrorMessage(sent.error, 'Unknown channel failure'),
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return input.receiver;
    }

    const updatedReceiver = await this.receiversRepository.markConsentRequested({
      receiverId: input.receiver.id,
      consentRequestedAt: requestedAt,
      consentTranscript: this.cryptoService.encrypt(
        JSON.stringify({
          requestedAt: requestedAt.toISOString(),
          channel: input.receiver.primaryChannel,
          ...sent.outcome.transcript,
        }),
      ),
    });

    await this.auditService.append({
      entityType: 'receiver',
      entityId: input.receiver.id,
      action: 'receiver.consent_requested',
      actorType: ActorType.USER,
      actorId: input.actorUserId,
      metadata: {
        channel: input.receiver.primaryChannel,
        templateKey: sent.outcome.templateKey,
        providerStatus: sent.outcome.providerStatus,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return updatedReceiver;
  }

  /**
   * Sender-triggered re-invitation. Only a receiver who has not answered can be re-asked, never inside a STOP
   * cooldown, and at most one invitation per 7 days counting the first one (BRD: "one per week max").
   * Returns null when the receiver is not the sender's.
   */
  async resendConsent(input: ResendReceiverConsentInput): Promise<ResendReceiverConsentResult | null> {
    const userId = input.userId.trim();
    const receiverId = input.receiverId.trim();
    const receiver = await this.receiversRepository.findForUserById({ userId, receiverId });
    if (!receiver) {
      return null;
    }
    if (receiver.consentStatus !== ConsentStatus.PENDING) {
      throw new ConsentNotPendingError(receiver.consentStatus);
    }

    const now = this.now();
    const cooldown = await this.receiversRepository.findOptOutCooldownByPhoneHash(receiver.phoneHash);
    if (cooldown && cooldown.cooldownUntil > now) {
      throw new OptOutCooldownError(cooldown.cooldownUntil);
    }
    if (receiver.consentRequestedAt) {
      const nextAllowedAt = addDays(receiver.consentRequestedAt, CONSENT_REQUEST_MIN_INTERVAL_DAYS);
      if (nextAllowedAt > now) {
        throw new ConsentResendLimitError(nextAllowedAt);
      }
    }

    const sent = await this.trySendConsentRequest(receiver, input.senderDisplayName);
    if (!sent.ok) {
      await this.auditService.append({
        entityType: 'receiver',
        entityId: receiver.id,
        action: 'receiver.consent_resend_failed',
        actorType: ActorType.USER,
        actorId: userId,
        metadata: {
          channel: receiver.primaryChannel,
          templateKey: sent.templateKey,
          error: auditSafeErrorMessage(sent.error, 'Unknown channel failure'),
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { receiver, sent: false };
    }

    const updatedReceiver = await this.receiversRepository.markConsentRequested({
      receiverId: receiver.id,
      consentRequestedAt: now,
      consentTranscript: this.cryptoService.encrypt(
        JSON.stringify({
          requestedAt: now.toISOString(),
          resend: true,
          previousRequestAt: receiver.consentRequestedAt?.toISOString(),
          channel: receiver.primaryChannel,
          ...sent.outcome.transcript,
        }),
      ),
    });

    await this.auditService.append({
      entityType: 'receiver',
      entityId: receiver.id,
      action: 'receiver.consent_resent',
      actorType: ActorType.USER,
      actorId: userId,
      metadata: {
        channel: receiver.primaryChannel,
        templateKey: sent.outcome.templateKey,
        providerStatus: sent.outcome.providerStatus,
        previousRequestAt: receiver.consentRequestedAt?.toISOString(),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { receiver: updatedReceiver, sent: true };
  }

  private async trySendConsentRequest(receiver: ReceiverRecord, senderDisplayName: string): Promise<ConsentSendResult> {
    const templateKey = receiver.primaryChannel === Channel.VOICE ? 'consent_request_voice' : 'consent_request';
    try {
      const to = this.cryptoService.decrypt(receiver.phoneEncrypted);
      const receiverDisplayName = this.cryptoService.decrypt(receiver.nameEncrypted);
      const outcome =
        receiver.primaryChannel === Channel.VOICE
          ? await this.requestVoiceConsent(receiver, to, senderDisplayName, receiverDisplayName)
          : await this.requestMessageConsent(receiver, to, senderDisplayName, receiverDisplayName);

      return { ok: true, outcome };
    } catch (error) {
      return { ok: false, templateKey, error };
    }
  }

  private async requestMessageConsent(
    receiver: ReceiverRecord,
    to: string,
    senderDisplayName: string,
    receiverDisplayName: string,
  ): Promise<ConsentSendOutcome> {
    const templateKey = 'consent_request';
    const personalNote = receiver.personalNoteEncrypted
      ? this.cryptoService.decrypt(receiver.personalNoteEncrypted)
      : undefined;
    const result = await this.channelRouter.sendMessage(receiver.primaryChannel, to, {
      templateKey,
      language: receiver.language,
      variables: {
        receiverName: receiverDisplayName,
        senderDisplayName,
        ...(personalNote ? { personalNote } : {}),
      },
    });

    return {
      templateKey,
      providerStatus: result.providerStatus,
      transcript: {
        templateKey,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        ...renderingAuditMetadata(result.rendering),
      },
    };
  }

  private async requestVoiceConsent(
    receiver: ReceiverRecord,
    to: string,
    senderDisplayName: string,
    receiverDisplayName: string,
  ): Promise<ConsentSendOutcome> {
    const scriptKey = 'consent_request_voice';
    const result = await this.channelRouter.makeVoiceCall(Channel.VOICE, to, {
      scriptKey,
      language: receiver.language,
      variables: {
        senderDisplayName,
        receiverDisplayName,
      },
    });

    return {
      templateKey: scriptKey,
      providerStatus: result.providerStatus,
      transcript: {
        scriptKey,
        providerCallId: result.providerCallId,
        providerStatus: result.providerStatus,
      },
    };
  }
}
