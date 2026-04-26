import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../shared/config/app-config.service';
import { ChannelRouterService } from './channel-router.service';
import { createChannelProviders } from './channel-providers.factory';
import { FakeChannelProvider } from './fake-channel.provider';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
  KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  SUPABASE_URL: 'https://nrohtflgytywovwabvdo.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
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
        variables: {},
      }),
    ).resolves.toMatchObject({
      providerStatus: 'accepted',
    });
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
