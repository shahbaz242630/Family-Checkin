import { createHmac, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, Inject, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CheckInsService } from '../check-ins/check-ins.service';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ReceiverReplyService } from '../receivers/receiver-reply.service';
import type { ProviderWebhookEventsRepository } from './provider-webhook-events.repository';
import { PROVIDER_WEBHOOK_EVENTS_REPOSITORY } from './provider-webhooks.tokens';

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

type TwilioMessagingWebhookBody = {
  From?: string;
  Body?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  MessageSid?: string;
};

type TwilioVoiceWebhookBody = {
  From?: string;
  To?: string;
  Digits?: string;
  SpeechResult?: string;
  CallSid?: string;
};

type TwilioVoiceStatusWebhookBody = {
  CallSid?: string;
  CallStatus?: string;
  CallDuration?: string;
  From?: string;
  To?: string;
};

type TwilioVoiceAmdWebhookBody = {
  CallSid?: string;
  AnsweredBy?: string;
  From?: string;
  To?: string;
};

// Machine-called by Twilio/WhatsApp in bursts and authenticated by signature/shared secret, so the global rate limit does not apply.
@SkipThrottle()
@Controller('provider-webhooks')
export class ProviderWebhooksController {
  constructor(
    @Inject(ReceiverReplyService)
    private readonly receiverReplyService: Pick<ReceiverReplyService, 'handleInboundReply'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'channelWebhookSecret' | 'twilioAuthToken' | 'publicApiBaseUrl'>,
    @Inject(PROVIDER_WEBHOOK_EVENTS_REPOSITORY)
    private readonly providerWebhookEventsRepository: ProviderWebhookEventsRepository,
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<CheckInsService, 'recordVoiceProviderFailure'>,
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

  @Post('twilio/messaging')
  async handleTwilioMessagingWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioMessagingWebhookBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/messaging', body);

    // Twilio can deliver the same MessageSid more than once (retries, fallback URL); the first delivery wins (CB-015).
    const event = await this.providerWebhookEventsRepository.createEventIfAbsent({
      provider: 'twilio',
      eventType: 'messaging_inbound',
      providerEventId: body.MessageSid,
      providerMessageId: body.MessageSid,
      payload: this.toInboundMessagingEventPayload(body),
    });
    if (!event.created) {
      return { ok: true, processed: 0 };
    }

    const reply = this.extractTwilioMessagingReply(body, ipAddress, userAgent);
    if (!reply) {
      return { ok: true, processed: 0 };
    }

    await this.receiverReplyService.handleInboundReply(reply);
    return { ok: true, processed: 1 };
  }

  @Post('twilio/voice')
  async handleTwilioVoiceWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceWebhookBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/voice', body);

    const reply = this.extractTwilioVoiceReply(body, ipAddress, userAgent);
    if (!reply) {
      return { ok: true, processed: 0 };
    }

    await this.receiverReplyService.handleInboundReply(reply);
    return { ok: true, processed: 1 };
  }

  @Post('twilio/voice/status')
  async handleTwilioVoiceStatusWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceStatusWebhookBody,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/voice/status', body);
    await this.providerWebhookEventsRepository.createEvent({
      provider: 'twilio',
      eventType: 'voice_status',
      providerEventId: this.twilioProviderEventId(body.CallSid, body.CallStatus),
      providerMessageId: body.CallSid,
      payload: body,
    });
    await this.checkInsService.recordVoiceProviderFailure({
      providerMessageId: body.CallSid,
      providerStatus: body.CallStatus,
    });

    return { ok: true, processed: 1 };
  }

  @Post('twilio/voice/amd')
  async handleTwilioVoiceAmdWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceAmdWebhookBody,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/voice/amd', body);
    await this.providerWebhookEventsRepository.createEvent({
      provider: 'twilio',
      eventType: 'voice_amd',
      providerEventId: this.twilioProviderEventId(body.CallSid, body.AnsweredBy),
      providerMessageId: body.CallSid,
      payload: body,
    });
    await this.checkInsService.recordVoiceProviderFailure({
      providerMessageId: body.CallSid,
      answeredBy: body.AnsweredBy,
    });

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

  private extractTwilioMessagingReply(
    body: TwilioMessagingWebhookBody,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): HandleInboundReceiverReplyInput | null {
    const replyBody = body.ButtonPayload ?? body.ButtonText ?? body.Body;
    if (!body.From || !replyBody) {
      return null;
    }

    const channel = body.From.startsWith('whatsapp:') ? Channel.WHATSAPP : Channel.SMS;
    const reply: HandleInboundReceiverReplyInput = {
      fromPhone: this.toInternationalPhone(body.From.replace(/^whatsapp:/, '')),
      channel,
      body: replyBody,
      ipAddress,
      userAgent,
    };

    if (body.MessageSid) {
      reply.providerMessageId = body.MessageSid;
    }

    return reply;
  }

  // provider_webhook_events is an operational log: phone numbers and message text stay out of it. The reply
  // service audits the outcome with the same PII-free shape.
  private toInboundMessagingEventPayload(body: TwilioMessagingWebhookBody): Record<string, string | undefined> {
    const replyBody = body.ButtonPayload ?? body.ButtonText ?? body.Body;
    let channel: string | undefined;
    if (body.From !== undefined) {
      channel = body.From.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    }

    return {
      MessageSid: body.MessageSid,
      channel,
      bodyLength: replyBody === undefined ? undefined : String(replyBody.length),
      hasButtonPayload: String(body.ButtonPayload !== undefined),
    };
  }

  private extractTwilioVoiceReply(
    body: TwilioVoiceWebhookBody,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): HandleInboundReceiverReplyInput | null {
    const replyBody = body.Digits ?? body.SpeechResult;
    if (!body.To || !replyBody) {
      return null;
    }

    const reply: HandleInboundReceiverReplyInput = {
      fromPhone: this.toInternationalPhone(body.To),
      channel: Channel.VOICE,
      body: replyBody,
      ipAddress,
      userAgent,
    };

    if (body.CallSid) {
      reply.providerMessageId = body.CallSid;
    }

    return reply;
  }

  private assertWebhookSecret(webhookSecret: string | undefined): void {
    const expected = this.config.channelWebhookSecret;
    if (!webhookSecret || !expected || !this.isMatchingSecret(webhookSecret, expected)) {
      throw new UnauthorizedException('Provider webhook secret is required');
    }
  }

  private assertTwilioSignature(
    twilioSignature: string | undefined,
    path:
      | '/provider-webhooks/twilio/messaging'
      | '/provider-webhooks/twilio/voice'
      | '/provider-webhooks/twilio/voice/status'
      | '/provider-webhooks/twilio/voice/amd',
    params: Record<string, string | undefined>,
  ): void {
    const authToken = this.config.twilioAuthToken;
    const publicApiBaseUrl = this.config.publicApiBaseUrl;

    if (!twilioSignature || !authToken || !publicApiBaseUrl) {
      throw new UnauthorizedException('Twilio signature is required');
    }

    const expectedSignature = this.computeTwilioSignature(`${publicApiBaseUrl}${path}`, params, authToken);
    if (!this.isMatchingSecret(twilioSignature, expectedSignature)) {
      throw new UnauthorizedException('Twilio signature is invalid');
    }
  }

  private computeTwilioSignature(url: string, params: Record<string, string | undefined>, authToken: string): string {
    const data = Object.keys(params)
      .filter((key) => params[key] !== undefined)
      .sort()
      .reduce((accumulator, key) => `${accumulator}${key}${params[key]}`, url);

    return createHmac('sha1', authToken).update(data).digest('base64');
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

  private twilioProviderEventId(primary: string | undefined, secondary: string | undefined): string | undefined {
    if (!primary) {
      return undefined;
    }

    return secondary ? `${primary}:${secondary}` : primary;
  }
}
