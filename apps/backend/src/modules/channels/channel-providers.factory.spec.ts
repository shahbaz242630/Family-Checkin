import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../shared/config/app-config.service';
import { ChannelRouterService } from './channel-router.service';
import { createChannelProviders } from './channel-providers.factory';
import { FakeChannelProvider } from './fake-channel.provider';
import { FakeOutboundRecorder } from './fake-outbound-recorder';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
  KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  SUPABASE_URL: 'https://nearby-test-project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OPERATIONS_CRON_SECRET: 'operations-cron-secret',
};

describe('createChannelProviders', () => {
  it('returns fake providers for local full-journey testing without credentials', async () => {
    const providers = createChannelProviders(
      new AppConfigService({
        ...baseEnv,
        CHANNEL_PROVIDER_MODE: 'fake',
      }),
    );
    const router = new ChannelRouterService(providers);

    expect(providers).toHaveLength(3);
    expect(providers.every((provider) => provider instanceof FakeChannelProvider)).toBe(true);
    await expect(
      router.sendMessage(Channel.WHATSAPP, '+971501234567', {
        templateKey: 'consent_request',
        language: 'en',
        variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
      }),
    ).resolves.toMatchObject({
      providerStatus: 'accepted',
      rendering: { language: 'en', fallback: false },
    });
  });

  it('hands the shared fake outbound recorder to every fake provider so one route can list all sends', async () => {
    const recorder = new FakeOutboundRecorder({ log: () => undefined });
    const providers = createChannelProviders(
      new AppConfigService({ ...baseEnv, CHANNEL_PROVIDER_MODE: 'fake' }),
      undefined,
      recorder,
    );

    expect(providers.every((provider) => (provider as FakeChannelProvider).recorder === recorder)).toBe(true);

    const router = new ChannelRouterService(providers);
    await router.sendMessage(Channel.SMS, '+971501234567', {
      templateKey: 'consent_request',
      language: 'en',
      variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
    });
    await router.makeVoiceCall(Channel.VOICE, '+971501234567', {
      scriptKey: 'checkin_daily_voice',
      language: 'en',
      variables: { receiverDisplayName: 'Fatima' },
    });

    expect(recorder.recent().map((record) => [record.kind, record.channel])).toEqual([
      ['voice_call', Channel.VOICE],
      ['message', Channel.SMS],
    ]);
  });

  it('returns configured adapter classes when provider mode is configured', () => {
    const providers = createChannelProviders(
      new AppConfigService({
        ...baseEnv,
        CHANNEL_PROVIDER_MODE: 'configured',
      }),
    );

    expect(providers).toEqual([expect.any(WhatsappProvider), expect.any(SmsProvider), expect.any(VoiceProvider)]);
  });
});
