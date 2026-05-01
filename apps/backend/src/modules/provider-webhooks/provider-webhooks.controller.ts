import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, Inject, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ReceiverReplyService } from '../receivers/receiver-reply.service';

interface ProviderWebhookResponse {
  ok: true;
  processed: number;
}

type WhatsappWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type SmsWebhookBody = {
  from?: string;
  body?: string;
  messageId?: string;
  receivedAt?: string;
  From?: string;
  Body?: string;
  MessageSid?: string;
};

@Controller('provider-webhooks')
export class ProviderWebhooksController {
  constructor(
    @Inject(ReceiverReplyService)
    private readonly receiverReplyService: Pick<ReceiverReplyService, 'handleInboundReply'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'channelWebhookSecret'>,
  ) {}

  @Post('whatsapp')
  async handleWhatsappWebhook(
    @Headers('x-nearby-webhook-secret') webhookSecret: string | undefined,
    @Body() body: WhatsappWebhookBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<ProviderWebhookResponse> {
    this.assertWebhookSecret(webhookSecret);

    let processed = 0;
    for (const reply of this.extractWhatsappReplies(body, ipAddress, userAgent)) {
      await this.receiverReplyService.handleInboundReply(reply);
      processed += 1;
    }

    return { ok: true, processed };
  }

  @Post('sms')
  async handleSmsWebhook(
    @Headers('x-nearby-webhook-secret') webhookSecret: string | undefined,
    @Body() body: SmsWebhookBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<ProviderWebhookResponse> {
    this.assertWebhookSecret(webhookSecret);

    const reply = this.extractSmsReply(body, ipAddress, userAgent);
    if (!reply) {
      return { ok: true, processed: 0 };
    }

    await this.receiverReplyService.handleInboundReply(reply);
    return { ok: true, processed: 1 };
  }

  private *extractWhatsappReplies(
    body: WhatsappWebhookBody,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Generator<HandleInboundReceiverReplyInput> {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== 'text' || !message.from || !message.text?.body) {
            continue;
          }

          const reply: HandleInboundReceiverReplyInput = {
            fromPhone: this.toInternationalPhone(message.from),
            channel: Channel.WHATSAPP,
            body: message.text.body,
            ipAddress,
            userAgent,
          };

          if (message.id) {
            reply.providerMessageId = message.id;
          }

          const providerReceivedAt = this.parseUnixTimestampSeconds(message.timestamp);
          if (providerReceivedAt) {
            reply.providerReceivedAt = providerReceivedAt;
          }

          yield reply;
        }
      }
    }
  }

  private extractSmsReply(
    body: SmsWebhookBody,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): HandleInboundReceiverReplyInput | null {
    const fromPhone = body.from ?? body.From;
    const replyBody = body.body ?? body.Body;

    if (!fromPhone || !replyBody) {
      return null;
    }

    const reply: HandleInboundReceiverReplyInput = {
      fromPhone: this.toInternationalPhone(fromPhone),
      channel: Channel.SMS,
      body: replyBody,
      ipAddress,
      userAgent,
    };

    const providerMessageId = body.messageId ?? body.MessageSid;
    if (providerMessageId) {
      reply.providerMessageId = providerMessageId;
    }

    const providerReceivedAt = this.parseIsoDate(body.receivedAt);
    if (providerReceivedAt) {
      reply.providerReceivedAt = providerReceivedAt;
    }

    return reply;
  }

  private assertWebhookSecret(webhookSecret: string | undefined): void {
    const expected = this.config.channelWebhookSecret;
    if (!webhookSecret || !expected || !this.isMatchingSecret(webhookSecret, expected)) {
      throw new UnauthorizedException('Provider webhook secret is required');
    }
  }

  private isMatchingSecret(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private toInternationalPhone(phone: string): string {
    const trimmed = phone.trim();
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  }

  private parseUnixTimestampSeconds(value: string | undefined): Date | undefined {
    if (!value) {
      return undefined;
    }

    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
      return undefined;
    }

    return new Date(timestamp * 1000);
  }

  private parseIsoDate(value: string | undefined): Date | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
