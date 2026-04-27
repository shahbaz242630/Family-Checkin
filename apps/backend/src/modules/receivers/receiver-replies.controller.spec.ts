import { Channel, ConsentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { HandleInboundReceiverReplyInput } from './receiver-reply.service';
import { ReceiverRepliesController } from './receiver-replies.controller';

class FakeReceiverReplyService {
  public handled: HandleInboundReceiverReplyInput[] = [];

  async handleInboundReply(input: HandleInboundReceiverReplyInput) {
    this.handled.push(input);
    return {
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'consent_granted',
      consentStatus: ConsentStatus.GRANTED,
    };
  }
}

describe('ReceiverRepliesController', () => {
  it('accepts fake inbound replies for local provider-free testing', async () => {
    const service = new FakeReceiverReplyService();
    const controller = new ReceiverRepliesController(service as never);

    const response = await controller.handleFakeInboundReply(
      {
        fromPhone: '+971501234567',
        channel: Channel.WHATSAPP,
        body: 'YES',
        providerMessageId: 'fake-provider-message-1',
      },
      '203.0.113.10',
      'ExpoLocalTest/1.0',
    );

    expect(response).toEqual({
      ok: true,
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      action: 'consent_granted',
      consentStatus: ConsentStatus.GRANTED,
    });
    expect(service.handled).toEqual([
      {
        fromPhone: '+971501234567',
        channel: Channel.WHATSAPP,
        body: 'YES',
        providerMessageId: 'fake-provider-message-1',
        ipAddress: '203.0.113.10',
        userAgent: 'ExpoLocalTest/1.0',
      },
    ]);
  });
});
