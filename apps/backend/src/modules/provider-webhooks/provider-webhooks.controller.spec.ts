import { Channel } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ProviderWebhooksController } from './provider-webhooks.controller';
import type { CreateProviderWebhookEventInput } from './provider-webhook-events.repository';

class FakeReceiverReplyService {
  public handled: HandleInboundReceiverReplyInput[] = [];

  public failNextWith?: Error;

  async handleInboundReply(input: HandleInboundReceiverReplyInput) {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = undefined;
      throw error;
    }
    this.handled.push(input);
    return {
      receiverId: 'receiver-1',
      action: 'check_in_responded_ok',
    };
  }
}

class FakeProviderWebhookEventsRepository {
  public events: CreateProviderWebhookEventInput[] = [];

  async createEvent(input: CreateProviderWebhookEventInput) {
    this.events.push(input);
    return { id: `event-${this.events.length}` };
  }

  async findEvent(key: { provider: string; eventType: string; providerEventId: string }) {
    const index = this.events.findIndex(
      (event) =>
        event.provider === key.provider &&
        event.eventType === key.eventType &&
        event.providerEventId === key.providerEventId,
    );
    return index >= 0 ? { id: `event-${index + 1}` } : null;
  }

  async createEventIfAbsent(input: CreateProviderWebhookEventInput) {
    const existingIndex = this.events.findIndex(
      (event) =>
        input.providerEventId !== undefined &&
        event.provider === input.provider &&
        event.eventType === input.eventType &&
        event.providerEventId === input.providerEventId,
    );
    if (existingIndex >= 0) {
      return { id: `event-${existingIndex + 1}`, created: false };
    }

    const created = await this.createEvent(input);
    return { ...created, created: true };
  }
}

class FakeCheckInsService {
  public voiceProviderFailures: Array<{ providerMessageId?: string; providerStatus?: string; answeredBy?: string }> =
    [];
  public messagingStatuses: Array<{ providerMessageId?: string; messageStatus?: string; errorCode?: string }> = [];

  async recordVoiceProviderFailure(input: {
    providerMessageId?: string;
    providerStatus?: string;
    answeredBy?: string;
  }) {
    this.voiceProviderFailures.push(input);
    return { updated: true };
  }

  async recordMessagingProviderStatus(input: {
    providerMessageId?: string;
    messageStatus?: string;
    errorCode?: string;
  }) {
    this.messagingStatuses.push(input);
    return { updated: input.messageStatus === 'undelivered' || input.messageStatus === 'failed' };
  }
}

const config = {
  channelWebhookSecret: 'provider-webhook-secret',
  twilioAuthToken: 'twilio-auth-token',
  publicApiBaseUrl: 'https://api.nearby.test',
};

describe('ProviderWebhooksController', () => {
  function makeController() {
    const service = new FakeReceiverReplyService();
    const eventsRepository = new FakeProviderWebhookEventsRepository();
    const checkInsService = new FakeCheckInsService();
    const controller = new ProviderWebhooksController(service as never, config, eventsRepository, checkInsService);

    return { controller, service, eventsRepository, checkInsService };
  }

  it('normalizes WhatsApp text messages into receiver replies', async () => {
    const { controller, service } = makeController();

    const response = await controller.handleWhatsappWebhook(
      'provider-webhook-secret',
      {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.1',
                      from: '971501234567',
                      timestamp: '1777626000',
                      type: 'text',
                      text: {
                        body: 'OK',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      '198.51.100.20',
      'MetaWebhook/1.0',
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234567',
        channel: Channel.WHATSAPP,
        body: 'OK',
        providerMessageId: 'wamid.1',
        providerReceivedAt: new Date(1777626000 * 1000),
        ipAddress: '198.51.100.20',
        userAgent: 'MetaWebhook/1.0',
      },
    ]);
  });

  it('ignores WhatsApp non-text messages without exposing payload details', async () => {
    const { controller, service } = makeController();

    const response = await controller.handleWhatsappWebhook(
      'provider-webhook-secret',
      {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.image',
                      from: '971501234567',
                      type: 'image',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      undefined,
      undefined,
    );

    expect(response).toEqual({
      ok: true,
      processed: 0,
    });
    expect(JSON.stringify(response)).not.toContain('971501234567');
    expect(service.handled).toEqual([]);
  });

  it('normalizes SMS provider payloads into receiver replies', async () => {
    const { controller, service } = makeController();

    const response = await controller.handleSmsWebhook(
      'provider-webhook-secret',
      {
        From: '+971501234568',
        Body: 'DONE',
        MessageSid: 'SM123',
      },
      '198.51.100.21',
      'SmsProvider/1.0',
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234568',
        channel: Channel.SMS,
        body: 'DONE',
        providerMessageId: 'SM123',
        ipAddress: '198.51.100.21',
        userAgent: 'SmsProvider/1.0',
      },
    ]);
  });

  it('rejects provider callbacks when the webhook secret is missing or wrong', async () => {
    const { controller, service } = makeController();

    await expect(controller.handleSmsWebhook('wrong-secret', { From: '+971501234568', Body: 'OK' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(service.handled).toEqual([]);
  });

  it('validates Twilio SMS signatures and normalizes inbound SMS replies', async () => {
    const { controller, service } = makeController();
    const params = {
      From: '+971501234569',
      Body: 'HELP',
      MessageSid: 'SM456',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      '203.0.113.30',
      'TwilioProxy/1.1',
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234569',
        channel: Channel.SMS,
        body: 'HELP',
        providerMessageId: 'SM456',
        ipAddress: '203.0.113.30',
        userAgent: 'TwilioProxy/1.1',
      },
    ]);
  });

  it('validates Twilio WhatsApp signatures and normalizes inbound WhatsApp replies', async () => {
    const { controller, service } = makeController();
    const params = {
      From: 'whatsapp:+971501234570',
      Body: 'OK',
      MessageSid: 'SM789',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      undefined,
      undefined,
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234570',
        channel: Channel.WHATSAPP,
        body: 'OK',
        providerMessageId: 'SM789',
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
  });

  it('prefers Twilio WhatsApp quick-reply button payloads over localized button text and body', async () => {
    const { controller, service } = makeController();
    const params = {
      From: 'whatsapp:+971501234570',
      Body: 'Estoy bien',
      ButtonText: 'Estoy bien',
      ButtonPayload: 'OK',
      MessageSid: 'SM790',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      undefined,
      undefined,
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234570',
        channel: Channel.WHATSAPP,
        body: 'OK',
        providerMessageId: 'SM790',
        ipAddress: undefined,
        userAgent: undefined,
      },
    ]);
  });

  it('validates Twilio voice signatures and normalizes DTMF replies', async () => {
    const { controller, service } = makeController();
    const params = {
      From: '+15550003333',
      To: '+971501234571',
      Digits: '1',
      CallSid: 'CA123',
    };

    const response = await controller.handleTwilioVoiceWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/voice', params),
      params,
      '203.0.113.31',
      'TwilioProxy/1.1',
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234571',
        channel: Channel.VOICE,
        body: '1',
        providerMessageId: 'CA123',
        ipAddress: '203.0.113.31',
        userAgent: 'TwilioProxy/1.1',
      },
    ]);
  });

  it('accepts signed Twilio voice status callbacks without treating them as receiver replies', async () => {
    const { controller, service, eventsRepository, checkInsService } = makeController();
    const params = {
      CallSid: 'CA123',
      CallStatus: 'completed',
      CallDuration: '12',
      From: '+15550003333',
      To: '+971501234571',
    };

    const response = await controller.handleTwilioVoiceStatusWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/voice/status', params),
      params,
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([]);
    expect(eventsRepository.events).toEqual([
      {
        provider: 'twilio',
        eventType: 'voice_status',
        providerEventId: 'CA123:completed',
        providerMessageId: 'CA123',
        payload: params,
      },
    ]);
    expect(checkInsService.voiceProviderFailures).toEqual([
      {
        providerMessageId: 'CA123',
        providerStatus: 'completed',
      },
    ]);
  });

  it('accepts signed Twilio AMD callbacks without treating machine answers as receiver replies', async () => {
    const { controller, service, eventsRepository, checkInsService } = makeController();
    const params = {
      CallSid: 'CA124',
      AnsweredBy: 'machine_start',
      From: '+15550003333',
      To: '+971501234572',
    };

    const response = await controller.handleTwilioVoiceAmdWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/voice/amd', params),
      params,
    );

    expect(response).toEqual({
      ok: true,
      processed: 1,
    });
    expect(service.handled).toEqual([]);
    expect(eventsRepository.events).toEqual([
      {
        provider: 'twilio',
        eventType: 'voice_amd',
        providerEventId: 'CA124:machine_start',
        providerMessageId: 'CA124',
        payload: params,
      },
    ]);
    expect(checkInsService.voiceProviderFailures).toEqual([
      {
        providerMessageId: 'CA124',
        answeredBy: 'machine_start',
      },
    ]);
  });

  it('stores a replayed Twilio voice status callback once and still hands it to the guarded check-in transition', async () => {
    const { controller, eventsRepository, checkInsService } = makeController();
    const params = { CallSid: 'CA125', CallStatus: 'no-answer', From: '+15550003333', To: '+971501234571' };
    const signature = signatureFor('https://api.nearby.test/provider-webhooks/twilio/voice/status', params);

    const first = await controller.handleTwilioVoiceStatusWebhook(signature, params);
    const replay = await controller.handleTwilioVoiceStatusWebhook(signature, params);

    expect(first).toEqual({ ok: true, processed: 1 });
    expect(replay).toEqual({ ok: true, processed: 0 });
    expect(eventsRepository.events).toHaveLength(1);
    expect(checkInsService.voiceProviderFailures).toHaveLength(2);
  });

  describe('Twilio message delivery status callbacks (CB-016)', () => {
    const statusUrl = 'https://api.nearby.test/provider-webhooks/twilio/messaging/status';

    it('accepts a signed undelivered status, stores one PII-free event and reports it to the check-in engine', async () => {
      const { controller, service, eventsRepository, checkInsService } = makeController();
      const params = {
        MessageSid: 'SM500',
        MessageStatus: 'undelivered',
        ErrorCode: '30003',
        To: '+971501234569',
        From: '+15550001111',
        AccountSid: 'AC123',
        ApiVersion: '2010-04-01',
      };

      const response = await controller.handleTwilioMessagingStatusWebhook(signatureFor(statusUrl, params), params);

      expect(response).toEqual({ ok: true, processed: 1 });
      expect(service.handled).toEqual([]);
      expect(checkInsService.messagingStatuses).toEqual([
        { providerMessageId: 'SM500', messageStatus: 'undelivered', errorCode: '30003' },
      ]);
      expect(eventsRepository.events).toEqual([
        {
          provider: 'twilio',
          eventType: 'messaging_status',
          providerEventId: 'SM500:undelivered',
          providerMessageId: 'SM500',
          payload: { MessageSid: 'SM500', MessageStatus: 'undelivered', ErrorCode: '30003', channel: 'sms' },
        },
      ]);
      expect(JSON.stringify(eventsRepository.events)).not.toContain('971501234569');
      expect(JSON.stringify(eventsRepository.events)).not.toContain('15550001111');
    });

    it('records a delivered WhatsApp status once and answers a replay with processed 0', async () => {
      const { controller, eventsRepository, checkInsService } = makeController();
      const params = {
        MessageSid: 'SM501',
        MessageStatus: 'delivered',
        To: 'whatsapp:+971501234570',
        From: 'whatsapp:+15550002222',
      };
      const signature = signatureFor(statusUrl, params);

      const first = await controller.handleTwilioMessagingStatusWebhook(signature, params);
      const replay = await controller.handleTwilioMessagingStatusWebhook(signature, params);

      expect(first).toEqual({ ok: true, processed: 1 });
      expect(replay).toEqual({ ok: true, processed: 0 });
      expect(eventsRepository.events).toEqual([
        expect.objectContaining({
          providerEventId: 'SM501:delivered',
          payload: { MessageSid: 'SM501', MessageStatus: 'delivered', ErrorCode: undefined, channel: 'whatsapp' },
        }),
      ]);
      // Each distinct status of one message is its own event; the engine decides which ones matter.
      expect(checkInsService.messagingStatuses).toEqual([
        { providerMessageId: 'SM501', messageStatus: 'delivered', errorCode: undefined },
      ]);
    });

    it('keeps every status of one message as a separate event', async () => {
      const { controller, eventsRepository } = makeController();
      for (const MessageStatus of ['queued', 'sent', 'failed']) {
        const params = { MessageSid: 'SM502', MessageStatus, To: '+971501234569' };
        await controller.handleTwilioMessagingStatusWebhook(signatureFor(statusUrl, params), params);
      }

      expect(eventsRepository.events.map((event) => event.providerEventId)).toEqual([
        'SM502:queued',
        'SM502:sent',
        'SM502:failed',
      ]);
    });

    it('does not record the status when the check-in engine throws, so the Twilio retry is processed', async () => {
      const { controller, eventsRepository, checkInsService } = makeController();
      const params = { MessageSid: 'SM503', MessageStatus: 'failed', To: '+971501234569' };
      const signature = signatureFor(statusUrl, params);
      const original = checkInsService.recordMessagingProviderStatus.bind(checkInsService);
      checkInsService.recordMessagingProviderStatus = async () => {
        checkInsService.recordMessagingProviderStatus = original;
        throw new Error('database unavailable');
      };

      await expect(controller.handleTwilioMessagingStatusWebhook(signature, params)).rejects.toThrow(
        'database unavailable',
      );
      expect(eventsRepository.events).toHaveLength(0);

      const retry = await controller.handleTwilioMessagingStatusWebhook(signature, params);

      expect(retry).toEqual({ ok: true, processed: 1 });
      expect(eventsRepository.events).toHaveLength(1);
    });

    it('rejects an unsigned status callback before touching anything', async () => {
      const { controller, eventsRepository, checkInsService } = makeController();

      await expect(
        controller.handleTwilioMessagingStatusWebhook(undefined, { MessageSid: 'SM504', MessageStatus: 'undelivered' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(eventsRepository.events).toEqual([]);
      expect(checkInsService.messagingStatuses).toEqual([]);
    });

    it('ignores a signed callback that carries no MessageSid or MessageStatus', async () => {
      const { controller, eventsRepository, checkInsService } = makeController();
      const params = { To: '+971501234569', From: '+15550001111' };

      const response = await controller.handleTwilioMessagingStatusWebhook(signatureFor(statusUrl, params), params);

      expect(response).toEqual({ ok: true, processed: 0 });
      expect(eventsRepository.events).toEqual([]);
      expect(checkInsService.messagingStatuses).toEqual([]);
    });
  });

  it('rejects Twilio callbacks with invalid signatures', async () => {
    const { controller, service, eventsRepository } = makeController();

    await expect(
      controller.handleTwilioMessagingWebhook('invalid-signature', {
        From: '+971501234569',
        Body: 'OK',
        MessageSid: 'SM456',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.handled).toEqual([]);
    expect(eventsRepository.events).toEqual([]);
  });

  it('stores one PII-free event per inbound Twilio message before handing it to the reply service', async () => {
    const { controller, service, eventsRepository } = makeController();
    const params = {
      From: '+971501234569',
      Body: "Thanks, I'm fine",
      MessageSid: 'SM900',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      '203.0.113.30',
      'TwilioProxy/1.1',
    );

    expect(response).toEqual({ ok: true, processed: 1 });
    expect(service.handled).toHaveLength(1);
    expect(eventsRepository.events).toEqual([
      {
        provider: 'twilio',
        eventType: 'messaging_inbound',
        providerEventId: 'SM900',
        providerMessageId: 'SM900',
        payload: {
          MessageSid: 'SM900',
          channel: 'sms',
          bodyLength: '16',
          hasButtonPayload: 'false',
        },
      },
    ]);
    expect(JSON.stringify(eventsRepository.events)).not.toContain('971501234569');
    expect(JSON.stringify(eventsRepository.events)).not.toContain('fine');
  });

  it('short-circuits a replayed Twilio MessageSid without re-processing the reply', async () => {
    const { controller, service, eventsRepository } = makeController();
    const params = {
      From: 'whatsapp:+971501234570',
      Body: 'OK',
      MessageSid: 'SM901',
    };
    const signature = signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params);

    const first = await controller.handleTwilioMessagingWebhook(signature, params, undefined, undefined);
    const replay = await controller.handleTwilioMessagingWebhook(signature, params, undefined, undefined);

    expect(first).toEqual({ ok: true, processed: 1 });
    expect(replay).toEqual({ ok: true, processed: 0 });
    expect(service.handled).toHaveLength(1);
    expect(eventsRepository.events).toHaveLength(1);
    expect(eventsRepository.events[0]?.payload.channel).toBe('whatsapp');
  });

  it('does not record the event when processing throws, so the Twilio retry is processed', async () => {
    const { controller, service, eventsRepository } = makeController();
    const params = {
      From: 'whatsapp:+971501234570',
      Body: 'OK',
      MessageSid: 'SM902',
    };
    const signature = signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params);
    service.failNextWith = new Error('database unavailable');

    await expect(controller.handleTwilioMessagingWebhook(signature, params, undefined, undefined)).rejects.toThrow(
      'database unavailable',
    );
    expect(eventsRepository.events).toHaveLength(0);

    const retry = await controller.handleTwilioMessagingWebhook(signature, params, undefined, undefined);

    expect(retry).toEqual({ ok: true, processed: 1 });
    expect(service.handled).toHaveLength(1);
    expect(eventsRepository.events).toHaveLength(1);
  });

  it('accepts a short-code sender and still records exactly one event', async () => {
    const { controller, service, eventsRepository } = makeController();
    const params = {
      From: '12345',
      Body: 'Your verification code is 000000',
      MessageSid: 'SM902',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      undefined,
      undefined,
    );

    expect(response).toEqual({ ok: true, processed: 1 });
    expect(service.handled).toEqual([
      expect.objectContaining({
        fromPhone: '+12345',
        channel: Channel.SMS,
        providerMessageId: 'SM902',
      }),
    ]);
    expect(eventsRepository.events).toHaveLength(1);
    expect(JSON.stringify(eventsRepository.events)).not.toContain('12345');
    expect(JSON.stringify(eventsRepository.events)).not.toContain('verification');
  });

  it('records inbound Twilio messages that carry no reply text without calling the reply service', async () => {
    const { controller, service, eventsRepository } = makeController();
    const params = {
      From: '+971501234569',
      MessageSid: 'SM903',
    };

    const response = await controller.handleTwilioMessagingWebhook(
      signatureFor('https://api.nearby.test/provider-webhooks/twilio/messaging', params),
      params,
      undefined,
      undefined,
    );

    expect(response).toEqual({ ok: true, processed: 0 });
    expect(service.handled).toEqual([]);
    expect(eventsRepository.events).toEqual([
      expect.objectContaining({
        providerEventId: 'SM903',
        payload: { MessageSid: 'SM903', channel: 'sms', bodyLength: undefined, hasButtonPayload: 'false' },
      }),
    ]);
  });
});

function signatureFor(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((accumulator, key) => `${accumulator}${key}${params[key]}`, url);

  return createHmac('sha1', config.twilioAuthToken).update(data).digest('base64');
}
