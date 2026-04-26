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
        variables: { receiverDisplayName: 'Fatima' },
      }),
    ).resolves.toEqual({
      providerMessageId: 'fake-SMS-message-1',
      acceptedAt: new Date('2026-04-26T10:00:00.000Z'),
      providerStatus: 'accepted',
    });

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
});
