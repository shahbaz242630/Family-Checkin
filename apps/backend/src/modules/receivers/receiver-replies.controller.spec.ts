import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Channel, ConsentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../shared/config/app-config.service';
import { FakeOutboundRecorder, type FakeOutboundRecord } from '../channels/fake-outbound-recorder';
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

const config = { operationsCronSecret: 'operations-cron-secret' } as AppConfigService;

function messageRecord(providerMessageId: string): FakeOutboundRecord {
  return {
    kind: 'message',
    at: '2026-09-06T10:00:00.000Z',
    channel: Channel.SMS,
    to: '+971501234567',
    providerMessageId,
    templateKey: 'account_step_up_otp',
    language: 'en',
    fallback: false,
    body: 'Your Nearby code is 482913. It is valid for 10 minutes.',
  };
}

function build(recorder = new FakeOutboundRecorder({ log: () => undefined })) {
  const service = new FakeReceiverReplyService();
  const controller = new ReceiverRepliesController(service as never, config, recorder);
  return { service, controller, recorder };
}

describe('ReceiverRepliesController', () => {
  it('accepts fake inbound replies for local provider-free testing with the operations cron bearer', async () => {
    const { service, controller } = build();

    const response = await controller.handleFakeInboundReply(
      'Bearer operations-cron-secret',
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

  it('requires the operations cron bearer token before touching any receiver', async () => {
    const { service, controller } = build();
    const body = { fromPhone: '+971501234567', channel: Channel.SMS, body: 'STOP' };

    await expect(controller.handleFakeInboundReply(undefined, body)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.handleFakeInboundReply('Basic operations-cron-secret', body)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.handleFakeInboundReply('Bearer wrong-secret', body)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.handled).toEqual([]);
  });

  it('lists what the fake providers sent, newest first, so an OTP or check-in body can be read locally', () => {
    const { controller, recorder } = build();
    recorder.record(messageRecord('fake-SMS-message-1'));
    recorder.record(messageRecord('fake-SMS-message-2'));
    recorder.record(messageRecord('fake-SMS-message-3'));

    expect(controller.listFakeOutbound('Bearer operations-cron-secret', undefined)).toEqual({
      ok: true,
      count: 3,
      sends: [
        expect.objectContaining({ providerMessageId: 'fake-SMS-message-3', body: expect.stringContaining('482913') }),
        expect.objectContaining({ providerMessageId: 'fake-SMS-message-2' }),
        expect.objectContaining({ providerMessageId: 'fake-SMS-message-1' }),
      ],
    });
    expect(controller.listFakeOutbound('Bearer operations-cron-secret', '1').sends).toEqual([
      expect.objectContaining({ providerMessageId: 'fake-SMS-message-3' }),
    ]);
  });

  it('rejects a limit that is not a whole number between 1 and 200', () => {
    const { controller } = build();

    for (const limit of ['0', '-1', '201', '1.5', 'ten']) {
      expect(() => controller.listFakeOutbound('Bearer operations-cron-secret', limit)).toThrow(BadRequestException);
    }
    expect(controller.listFakeOutbound('Bearer operations-cron-secret', '').count).toBe(0);
  });

  it('requires the operations cron bearer token before listing any message body', () => {
    const { controller, recorder } = build();
    recorder.record(messageRecord('fake-SMS-message-1'));

    expect(() => controller.listFakeOutbound(undefined, undefined)).toThrow(UnauthorizedException);
    expect(() => controller.listFakeOutbound('Bearer wrong-secret', undefined)).toThrow(UnauthorizedException);
  });
});
