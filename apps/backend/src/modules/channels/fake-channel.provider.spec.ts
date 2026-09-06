import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from './fake-channel.provider';

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

  it('fails a fake send on a missing variable exactly like a real provider would, recording nothing', async () => {
    const provider = new FakeChannelProvider(Channel.WHATSAPP);

    await expect(
      provider.sendMessage('+971501234567', { templateKey: 'checkin_daily', language: 'en', variables: {} }),
    ).rejects.toThrow('requires variable "receiverName"');
    expect(provider.sentMessages).toEqual([]);
    expect(provider.renderedMessages).toEqual([]);
  });
});
