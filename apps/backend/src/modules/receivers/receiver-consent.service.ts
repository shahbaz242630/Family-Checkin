import { Inject, Injectable } from '@nestjs/common';
import { ActorType, Channel } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { ReceiverRecord, ReceiversRepository } from './receivers.repository';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';

export interface RequestReceiverConsentInput {
  receiver: ReceiverRecord;
  actorUserId: string;
  senderDisplayName: string;
  ipAddress?: string;
  userAgent?: string;
}

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
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestConsent(input: RequestReceiverConsentInput): Promise<ReceiverRecord> {
    if (input.receiver.consentRequestedAt) {
      throw new Error('Receiver consent has already been requested');
    }

    const requestedAt = this.now();
    const to = this.cryptoService.decrypt(input.receiver.phoneEncrypted);
    const receiverDisplayName = this.cryptoService.decrypt(input.receiver.nameEncrypted);

    const providerResult =
      input.receiver.primaryChannel === Channel.VOICE
        ? await this.requestVoiceConsent(input.receiver, to, input.senderDisplayName, receiverDisplayName)
        : await this.requestMessageConsent(input.receiver, to, input.senderDisplayName, receiverDisplayName);

    const updatedReceiver = await this.receiversRepository.markConsentRequested({
      receiverId: input.receiver.id,
      consentRequestedAt: requestedAt,
      consentTranscript: this.cryptoService.encrypt(
        JSON.stringify({
          requestedAt: requestedAt.toISOString(),
          channel: input.receiver.primaryChannel,
          ...providerResult.transcript,
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
        templateKey: providerResult.templateKey,
        providerStatus: providerResult.providerStatus,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return updatedReceiver;
  }

  private async requestMessageConsent(
    receiver: ReceiverRecord,
    to: string,
    senderDisplayName: string,
    receiverDisplayName: string,
  ): Promise<{
    templateKey: string;
    providerStatus: string;
    transcript: { templateKey: string; providerMessageId: string; providerStatus: string };
  }> {
    const templateKey = 'consent_request';
    const result = await this.channelRouter.sendMessage(receiver.primaryChannel, to, {
      templateKey,
      language: receiver.language,
      variables: {
        senderDisplayName,
        receiverDisplayName,
      },
    });

    return {
      templateKey,
      providerStatus: result.providerStatus,
      transcript: {
        templateKey,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
      },
    };
  }

  private async requestVoiceConsent(
    receiver: ReceiverRecord,
    to: string,
    senderDisplayName: string,
    receiverDisplayName: string,
  ): Promise<{
    templateKey: string;
    providerStatus: string;
    transcript: { scriptKey: string; providerCallId: string; providerStatus: string };
  }> {
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
