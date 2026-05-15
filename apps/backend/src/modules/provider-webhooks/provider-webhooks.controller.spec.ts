import { Channel } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ProviderWebhooksController } from './provider-webhooks.controller';
import type { CreateProviderWebhookEventInput } from './provider-webhook-events.repository';

class FakeReceiverReplyService {
  public handled: HandleInboundReceiverReplyInput[] = [];

  async handleInboundReply(input: HandleInboundReceiverReplyInput) {
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
    const controller = new ProviderWebhooksController(service as never, config, eventsRepository);

    return { controller, service, eventsRepository };
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
    const { controller, service, eventsRepository } = makeController();
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
  });

  it('accepts signed Twilio AMD callbacks without treating machine answers as receiver replies', async () => {
    const { controller, service, eventsRepository } = makeController();
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
  });

  it('rejects Twilio callbacks with invalid signatures', async () => {
    const { controller, service } = makeController();

    await expect(
      controller.handleTwilioMessagingWebhook('invalid-signature', {
        From: '+971501234569',
        Body: 'OK',
        MessageSid: 'SM456',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.handled).toEqual([]);
  });
});

function signatureFor(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((accumulator, key) => `${accumulator}${key}${params[key]}`, url);

  return createHmac('sha1', config.twilioAuthToken).update(data).digest('base64');
}
