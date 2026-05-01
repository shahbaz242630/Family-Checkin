import { describe, expect, it } from 'vitest';
import { AppConfigService } from './app-config.service';

describe('AppConfigService', () => {
  it('parses required backend environment variables', () => {
    const config = new AppConfigService({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
      KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
      SUPABASE_URL: 'https://nrohtflgytywovwabvdo.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      OPERATIONS_CRON_SECRET: 'operations-cron-secret',
      PUBLIC_API_BASE_URL: 'https://api.nearby.test/',
      CHANNEL_PROVIDER_MODE: 'fake',
      SMS_PROVIDER_API_KEY: 'sms-key',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_SMS_FROM_NUMBER: '+15550001111',
      TWILIO_WHATSAPP_FROM_NUMBER: '+15550002222',
      TWILIO_VOICE_FROM_NUMBER: '+15550003333',
      WHATSAPP_ACCESS_TOKEN: 'whatsapp-token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      CHANNEL_WEBHOOK_SECRET: 'provider-webhook-secret',
      VOICE_PROVIDER_API_KEY: 'voice-key',
      PORT: '4000',
    });

    expect(config.databaseUrl).toBe('postgresql://postgres:postgres@localhost:5432/nearby');
    expect(config.kmsMasterKey).toEqual(Buffer.from('0123456789abcdef0123456789abcdef'));
    expect(config.supabaseUrl).toBe('https://nrohtflgytywovwabvdo.supabase.co');
    expect(config.supabaseAnonKey).toBe('anon-key');
    expect(config.supabaseServiceRoleKey).toBe('service-role-key');
    expect(config.operationsCronSecret).toBe('operations-cron-secret');
    expect(config.publicApiBaseUrl).toBe('https://api.nearby.test');
    expect(config.channelProviderMode).toBe('fake');
    expect(config.smsProviderApiKey).toBe('sms-key');
    expect(config.twilioAccountSid).toBe('AC123');
    expect(config.twilioAuthToken).toBe('twilio-auth-token');
    expect(config.twilioSmsFromNumber).toBe('+15550001111');
    expect(config.twilioWhatsappFromNumber).toBe('+15550002222');
    expect(config.twilioVoiceFromNumber).toBe('+15550003333');
    expect(config.whatsappAccessToken).toBe('whatsapp-token');
    expect(config.whatsappPhoneNumberId).toBe('phone-number-id');
    expect(config.channelWebhookSecret).toBe('provider-webhook-secret');
    expect(config.voiceProviderApiKey).toBe('voice-key');
    expect(config.port).toBe(4000);
  });

  it('rejects invalid or missing required environment variables', () => {
    expect(
      () =>
        new AppConfigService({
          DATABASE_URL: 'not-a-url',
          KMS_MASTER_KEY_BASE64: 'short',
          SUPABASE_URL: 'not-a-url',
          SUPABASE_ANON_KEY: '',
          SUPABASE_SERVICE_ROLE_KEY: '',
          OPERATIONS_CRON_SECRET: '',
        }),
    ).toThrow('Invalid backend environment');
  });
});
