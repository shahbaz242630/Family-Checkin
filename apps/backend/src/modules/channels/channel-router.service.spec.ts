import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from './fake-channel.provider';
import { ChannelRouterService } from './channel-router.service';

describe('ChannelRouterService', () => {
  it('routes templated messages to the provider registered for the requested channel', async () => {
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    const sms = new FakeChannelProvider(Channel.SMS);
    const router = new ChannelRouterService([whatsapp, sms]);

    const result = await router.sendMessage(Channel.SMS, '+971501234567', {
      templateKey: 'consent_request',
      language: 'en',
      variables: {
        senderDisplayName: 'Ahmed',
      },
    });

    expect(result.providerMessageId).toMatch(/^fake-SMS-message-/);
    expect(sms.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'consent_request',
          language: 'en',
          variables: {
            senderDisplayName: 'Ahmed',
          },
        },
      },
    ]);
    expect(whatsapp.sentMessages).toEqual([]);
  });

  it('routes voice calls to the voice provider', async () => {
    const voice = new FakeChannelProvider(Channel.VOICE);
    const router = new ChannelRouterService([voice]);

    const result = await router.makeVoiceCall(Channel.VOICE, '+971501234567', {
      scriptKey: 'consent_request_voice',
      language: 'en',
      variables: {
        senderDisplayName: 'Ahmed',
      },
    });

    expect(result.providerCallId).toMatch(/^fake-VOICE-call-/);
    expect(voice.voiceCalls).toHaveLength(1);
  });

  it('passes voice call options through to the voice provider', async () => {
    const voice = new FakeChannelProvider(Channel.VOICE);
    const router = new ChannelRouterService([voice]);

    await router.makeVoiceCall(
      Channel.VOICE,
      '+971501234567',
      {
        scriptKey: 'checkin_daily_voice',
        language: 'en',
        variables: {},
      },
      { fromNumber: '+15559990000' },
    );

    expect(voice.voiceCalls[0]?.options).toEqual({ fromNumber: '+15559990000' });
  });

  it('checks provider availability for a phone number', async () => {
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      availableNumbers: ['+971501234567'],
    });
    const router = new ChannelRouterService([whatsapp]);

    await expect(router.isAvailableForNumber(Channel.WHATSAPP, '+971501234567')).resolves.toBe(true);
    await expect(router.isAvailableForNumber(Channel.WHATSAPP, '+971509999999')).resolves.toBe(false);
  });

  it('resolves a reachable channel plan without pretending WhatsApp detection is guaranteed', async () => {
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      availableNumbers: [],
    });
    const sms = new FakeChannelProvider(Channel.SMS, {
      availableNumbers: ['+971501234567'],
    });
    const voice = new FakeChannelProvider(Channel.VOICE, {
      availableNumbers: ['+971501234567'],
    });
    const router = new ChannelRouterService([whatsapp, sms, voice]);

    await expect(
      router.resolveReachablePlan({
        phone: '+971501234567',
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
      }),
    ).resolves.toEqual({
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
      detectionStatus: 'FALLBACK_SELECTED',
      unavailableChannels: [Channel.WHATSAPP],
      detectionConfidence: 'provider_availability_check',
    });
  });

  it('rejects unregistered channels', async () => {
    const router = new ChannelRouterService([]);

    await expect(
      router.sendMessage(Channel.WHATSAPP, '+971501234567', {
        templateKey: 'consent_request',
        language: 'en',
        variables: {},
      }),
    ).rejects.toThrow('No channel provider registered for WHATSAPP');
  });
});
