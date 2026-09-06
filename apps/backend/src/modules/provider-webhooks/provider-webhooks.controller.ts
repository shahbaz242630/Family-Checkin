import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import {
  renderTwilioVoiceReplyTwiml,
  TWILIO_VOICE_GATHER_ACTION_PATH,
  TWILIO_VOICE_LANGUAGE_QUERY_PARAM,
} from '../channels/twilio-rendering';
import { CheckInsService } from '../check-ins/check-ins.service';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ReceiverReplyService } from '../receivers/receiver-reply.service';
import type { ProviderWebhookEventsRepository } from './provider-webhook-events.repository';
import { PROVIDER_WEBHOOK_EVENTS_REPOSITORY } from './provider-webhooks.tokens';
import { twilioVoiceReplyKeyword } from './twilio-voice-input';

interface ProviderWebhookResponse {
  ok: true;
  processed: number;
}

type TwilioMessagingWebhookBody = {
  From?: string;
  Body?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  MessageSid?: string;
};

/** Twilio `StatusCallback` for an outbound SMS or WhatsApp message; `To` is the receiver, `From` our number. */
type TwilioMessagingStatusWebhookBody = {
  MessageSid?: string;
  MessageStatus?: string;
  ErrorCode?: string;
  To?: string;
  From?: string;
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

/**
 * The part of the incoming request the voice route needs: the URL exactly as Twilio requested it, query string
 * included, because Twilio's signature covers the full URL and the Gather action carries `?lang=` (CB-022).
 */
export interface WebhookRequestUrl {
  originalUrl?: string;
  url?: string;
}

type TwilioSignedPath =
  | '/provider-webhooks/twilio/messaging'
  | '/provider-webhooks/twilio/messaging/status'
  | typeof TWILIO_VOICE_GATHER_ACTION_PATH
  | '/provider-webhooks/twilio/voice/status'
  | '/provider-webhooks/twilio/voice/amd';

// Machine-called by Twilio in bursts and authenticated by signature, so the global rate limit does not apply.
@SkipThrottle()
@Controller('provider-webhooks')
export class ProviderWebhooksController {
  constructor(
    @Inject(ReceiverReplyService)
    private readonly receiverReplyService: Pick<ReceiverReplyService, 'handleInboundReply'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'twilioAuthToken' | 'publicApiBaseUrl'>,
    @Inject(PROVIDER_WEBHOOK_EVENTS_REPOSITORY)
    private readonly providerWebhookEventsRepository: ProviderWebhookEventsRepository,
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<
      CheckInsService,
      'recordVoiceProviderFailure' | 'recordMessagingProviderStatus'
    >,
  ) {}

  /**
   * Inbound SMS and WhatsApp replies. This is the URL Twilio must be given as the messaging webhook of the SMS
   * number and of the WhatsApp sender: `${PUBLIC_API_BASE_URL}/provider-webhooks/twilio/messaging`
   * (docs/providers/twilio.md).
   */
  @Post('twilio/messaging')
  async handleTwilioMessagingWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioMessagingWebhookBody,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/messaging', body);

    // Twilio can deliver the same MessageSid more than once (retries, fallback URL). Check for a stored event before
    // processing, and store it only after processing succeeded: a transient failure then leaves nothing behind, so
    // Twilio's retry is processed instead of being mistaken for a replay (CB-015).
    const eventKey = { provider: 'twilio', eventType: 'messaging_inbound', providerEventId: body.MessageSid };
    if (
      body.MessageSid &&
      (await this.providerWebhookEventsRepository.findEvent({ ...eventKey, providerEventId: body.MessageSid }))
    ) {
      return { ok: true, processed: 0 };
    }

    const reply = this.extractTwilioMessagingReply(body, ipAddress, userAgent);
    if (reply) {
      await this.receiverReplyService.handleInboundReply(reply);
    }

    await this.providerWebhookEventsRepository.createEventIfAbsent({
      ...eventKey,
      providerMessageId: body.MessageSid,
      payload: this.toInboundMessagingEventPayload(body),
    });
    return { ok: true, processed: reply ? 1 : 0 };
  }

  /**
   * Delivery status of an outbound SMS or WhatsApp message (the `StatusCallback` the providers pass, CB-016). Every
   * status is stored once, keyed `MessageSid:MessageStatus`; `undelivered` and `failed` also fail the matching
   * attempt so the cascade moves on at the next tick instead of waiting out the response window. Stored after
   * processing for the same reason as inbound messages (CB-015): a transient failure leaves nothing behind and
   * Twilio's retry is processed rather than mistaken for a replay.
   */
  @Post('twilio/messaging/status')
  async handleTwilioMessagingStatusWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioMessagingStatusWebhookBody,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/messaging/status', body);

    const messageSid = body.MessageSid?.trim();
    const messageStatus = body.MessageStatus?.trim().toLowerCase();
    if (!messageSid || !messageStatus) {
      return { ok: true, processed: 0 };
    }

    const eventKey = {
      provider: 'twilio',
      eventType: 'messaging_status',
      providerEventId: `${messageSid}:${messageStatus}`,
    };
    if (await this.providerWebhookEventsRepository.findEvent(eventKey)) {
      return { ok: true, processed: 0 };
    }

    await this.checkInsService.recordMessagingProviderStatus({
      providerMessageId: messageSid,
      messageStatus,
      errorCode: body.ErrorCode,
    });

    const stored = await this.providerWebhookEventsRepository.createEventIfAbsent({
      ...eventKey,
      providerMessageId: messageSid,
      payload: this.toMessagingStatusEventPayload(body, messageSid, messageStatus),
    });
    return { ok: true, processed: stored.created ? 1 : 0 };
  }

  /**
   * The `<Gather>` action of every outbound call (CB-022). Twilio expects TwiML back, so this route answers
   * `200 text/xml` with a short thank-you in the receiver's language and hangs up; a JSON body here is Twilio error
   * 12100 and a call that ends in an error tone. The language travels in the action URL's `lang` query parameter
   * (the body only carries numbers, digits and the call SID) and is part of the signed URL. Digits are mapped by
   * `twilioVoiceReplyKeyword` (1 YES, 2 HELP, 9 STOP); any other digit ends the call with the same thank-you and
   * is not recorded.
   */
  @Post('twilio/voice')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  async handleTwilioVoiceWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceWebhookBody,
    @Req() request: WebhookRequestUrl | undefined,
    @Ip() ipAddress?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<string> {
    const query = queryStringOf(request);
    this.assertTwilioSignature(twilioSignature, TWILIO_VOICE_GATHER_ACTION_PATH, body, query);
    const language = new URLSearchParams(query).get(TWILIO_VOICE_LANGUAGE_QUERY_PARAM) ?? '';

    const reply = this.extractTwilioVoiceReply(body, ipAddress, userAgent);
    if (reply) {
      await this.receiverReplyService.handleInboundReply(reply);
    }

    return renderTwilioVoiceReplyTwiml(language);
  }

  @Post('twilio/voice/status')
  async handleTwilioVoiceStatusWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceStatusWebhookBody,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/voice/status', body);
    const stored = await this.providerWebhookEventsRepository.createEventIfAbsent({
      provider: 'twilio',
      eventType: 'voice_status',
      providerEventId: this.twilioProviderEventId(body.CallSid, body.CallStatus),
      providerMessageId: body.CallSid,
      payload: body,
    });
    // The transition is status-guarded, so running it again on a replay is harmless and covers a retry after a
    // failure between the store and the transition.
    await this.checkInsService.recordVoiceProviderFailure({
      providerMessageId: body.CallSid,
      providerStatus: body.CallStatus,
    });

    return { ok: true, processed: stored.created ? 1 : 0 };
  }

  @Post('twilio/voice/amd')
  async handleTwilioVoiceAmdWebhook(
    @Headers('x-twilio-signature') twilioSignature: string | undefined,
    @Body() body: TwilioVoiceAmdWebhookBody,
  ): Promise<ProviderWebhookResponse> {
    this.assertTwilioSignature(twilioSignature, '/provider-webhooks/twilio/voice/amd', body);
    const stored = await this.providerWebhookEventsRepository.createEventIfAbsent({
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

    return { ok: true, processed: stored.created ? 1 : 0 };
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

  /** Same rule as inbound events: ids, status and channel only; `To`/`From` are phone numbers and stay out. */
  private toMessagingStatusEventPayload(
    body: TwilioMessagingStatusWebhookBody,
    messageSid: string,
    messageStatus: string,
  ): Record<string, string | undefined> {
    let channel: string | undefined;
    if (body.To !== undefined) {
      channel = body.To.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    }

    return {
      MessageSid: messageSid,
      MessageStatus: messageStatus,
      ErrorCode: body.ErrorCode,
      channel,
    };
  }

  /** `To` is the receiver on an outbound call; the keypad digit becomes the keyword the reply service parses. */
  private extractTwilioVoiceReply(
    body: TwilioVoiceWebhookBody,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): HandleInboundReceiverReplyInput | null {
    const keyword = twilioVoiceReplyKeyword({ digits: body.Digits, speechResult: body.SpeechResult });
    if (!body.To || !keyword) {
      return null;
    }

    const reply: HandleInboundReceiverReplyInput = {
      fromPhone: this.toInternationalPhone(body.To),
      channel: Channel.VOICE,
      body: keyword,
      ipAddress,
      userAgent,
    };

    if (body.CallSid) {
      reply.providerMessageId = body.CallSid;
    }

    return reply;
  }

  /**
   * Twilio signs the full URL it requested (query string included) followed by the sorted POST parameters; the
   * expected URL is rebuilt from `PUBLIC_API_BASE_URL`, the route path and the query string as received, so a
   * route or base-URL change breaks every signature by design.
   */
  private assertTwilioSignature(
    twilioSignature: string | undefined,
    path: TwilioSignedPath,
    params: Record<string, string | undefined>,
    queryString = '',
  ): void {
    const authToken = this.config.twilioAuthToken;
    const publicApiBaseUrl = this.config.publicApiBaseUrl;

    if (!twilioSignature || !authToken || !publicApiBaseUrl) {
      throw new UnauthorizedException('Twilio signature is required');
    }

    const url = `${publicApiBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;
    const expectedSignature = this.computeTwilioSignature(url, params, authToken);
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

  private twilioProviderEventId(primary: string | undefined, secondary: string | undefined): string | undefined {
    if (!primary) {
      return undefined;
    }

    return secondary ? `${primary}:${secondary}` : primary;
  }
}

/** The raw query string (without `?`) of the request as received, or an empty string. */
function queryStringOf(request: WebhookRequestUrl | undefined): string {
  const raw = request?.originalUrl ?? request?.url ?? '';
  const index = raw.indexOf('?');
  return index >= 0 ? raw.slice(index + 1) : '';
}
