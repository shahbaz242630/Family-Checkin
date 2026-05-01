import { Channel } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { HandleInboundReceiverReplyInput } from '../receivers/receiver-reply.service';
import { ProviderWebhooksController } from './provider-webhooks.controller';

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

const config = {
  channelWebhookSecret: 'provider-webhook-secret',
};

describe('ProviderWebhooksController', () => {
  it('normalizes WhatsApp text messages into receiver replies', async () => {
    const service = new FakeReceiverReplyService();
    const controller = new ProviderWebhooksController(service as never, config);

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
    const service = new FakeReceiverReplyService();
    const controller = new ProviderWebhooksController(service as never, config);

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
    const service = new FakeReceiverReplyService();
    const controller = new ProviderWebhooksController(service as never, config);

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
    const service = new FakeReceiverReplyService();
    const controller = new ProviderWebhooksController(service as never, config);

    await expect(controller.handleSmsWebhook('wrong-secret', { From: '+971501234568', Body: 'OK' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(service.handled).toEqual([]);
  });
});
