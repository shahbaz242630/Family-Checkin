import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from './fake-channel.provider';
import type { FakeOutboundRecord } from './fake-outbound-recorder';

describe('FakeChannelProvider', () => {
  it('captures outbound messages and calls for deterministic tests', async () => {
    const provider = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-26T10:00:00.000Z'),
    });

    await expect(
      provider.sendMessage('+971501234567', {
        templateKey: 'checkin_daily',
        language: 'en',
        variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
      }),
    ).resolves.toEqual({
      providerMessageId: 'fake-SMS-message-1',
      acceptedAt: new Date('2026-04-26T10:00:00.000Z'),
      providerStatus: 'accepted',
      rendering: { language: 'en', fallback: false },
    });
    expect(provider.renderedMessages).toEqual([
      {
        to: '+971501234567',
        templateKey: 'checkin_daily',
        language: 'en',
        fallback: false,
        body:
          "Hi Fatima, Ahmed is checking in on you today. Reply YES if you're okay or HELP if you need help. " +
          'Reply STOP to stop, REPORT to report.',
      },
    ]);

    await expect(
      provider.makeVoiceCall('+971501234567', {
        scriptKey: 'checkin_voice',
        language: 'en',
        variables: { receiverDisplayName: 'Fatima' },
      }),
    ).resolves.toEqual({
      providerCallId: 'fake-SMS-call-1',
      acceptedAt: new Date('2026-04-26T10:00:00.000Z'),
      providerStatus: 'accepted',
    });
  });

  it('reports every send and call to the recorder with the rendered body, so a running backend can show them', async () => {
    const recorded: FakeOutboundRecord[] = [];
    const provider = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-09-06T10:00:00.000Z'),
      recorder: { record: (record) => recorded.push(record) },
    });

    await provider.sendMessage('+971501234567', {
      templateKey: 'account_step_up_otp',
      language: 'en',
      variables: { code: '482913', validityMinutes: '10' },
    });
    await provider.makeVoiceCall(
      '+971501234567',
      { scriptKey: 'checkin_daily_voice', language: 'en', variables: { receiverDisplayName: 'Fatima' } },
      { fromNumber: '+441134960000' },
    );

    expect(recorded).toEqual([
      {
        kind: 'message',
        at: '2026-09-06T10:00:00.000Z',
        channel: Channel.SMS,
        to: '+971501234567',
        providerMessageId: 'fake-SMS-message-1',
        templateKey: 'account_step_up_otp',
        language: 'en',
        fallback: false,
        body: expect.stringContaining('482913'),
      },
      {
        kind: 'voice_call',
        at: '2026-09-06T10:00:00.000Z',
        channel: Channel.SMS,
        to: '+971501234567',
        providerCallId: 'fake-SMS-call-1',
        scriptKey: 'checkin_daily_voice',
        language: 'en',
        variables: { receiverDisplayName: 'Fatima' },
        fromNumber: '+441134960000',
      },
    ]);
  });

  it('fails a fake send on a missing variable exactly like a real provider would, recording nothing', async () => {
    const recorded: FakeOutboundRecord[] = [];
    const provider = new FakeChannelProvider(Channel.WHATSAPP, {
      recorder: { record: (record) => recorded.push(record) },
    });

    await expect(
      provider.sendMessage('+971501234567', { templateKey: 'checkin_daily', language: 'en', variables: {} }),
    ).rejects.toThrow('requires variable "receiverName"');
    expect(provider.sentMessages).toEqual([]);
    expect(provider.renderedMessages).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('keeps working with no recorder attached', async () => {
    const provider = new FakeChannelProvider(Channel.WHATSAPP);

    await expect(
      provider.sendMessage('+971501234567', { templateKey: 'checkin_daily', language: 'en', variables: {} }),
    ).rejects.toThrow('requires variable "receiverName"');
    expect(provider.sentMessages).toEqual([]);
    expect(provider.renderedMessages).toEqual([]);
  });
});
