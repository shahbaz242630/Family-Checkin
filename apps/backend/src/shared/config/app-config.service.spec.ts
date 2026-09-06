import { describe, expect, it } from 'vitest';
import { AppConfigService, parseTwilioWhatsappContentSids } from './app-config.service';

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
    KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    SUPABASE_URL: 'https://nearby-test-project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    OPERATIONS_CRON_SECRET: 'operations-cron-secret',
    ...overrides,
  };
}

describe('AppConfigService', () => {
  it('parses required backend environment variables', () => {
    const config = new AppConfigService(
      validEnv({
        PUBLIC_API_BASE_URL: 'https://api.nearby.test/',
        CHANNEL_PROVIDER_MODE: 'fake',
        TWILIO_ACCOUNT_SID: 'AC123',
        TWILIO_SMS_FROM_NUMBER: '+15550001111',
        TWILIO_WHATSAPP_FROM_NUMBER: '+15550002222',
        TWILIO_WHATSAPP_CONTENT_SIDS: '{"consent_request:en": " HX1 ", "checkin_daily": "HX2"}',
        TWILIO_VOICE_FROM_NUMBER: '+15550003333',
        VOICE_AUDIO_BASE_URL: 'https://cdn.nearby.test/voice/',
        TWILIO_AUTH_TOKEN: 'twilio-auth-token',
        PORT: '4000',
      }),
    );

    expect(config.databaseUrl).toBe('postgresql://postgres:postgres@localhost:5432/nearby');
    expect(config.kmsMasterKey).toEqual(Buffer.from('0123456789abcdef0123456789abcdef'));
    expect(config.supabaseUrl).toBe('https://nearby-test-project.supabase.co');
    expect(config.supabaseAnonKey).toBe('anon-key');
    expect(config.operationsCronSecret).toBe('operations-cron-secret');
    expect(config.publicApiBaseUrl).toBe('https://api.nearby.test');
    expect(config.channelProviderMode).toBe('fake');
    expect(config.twilioAccountSid).toBe('AC123');
    expect(config.twilioAuthToken).toBe('twilio-auth-token');
    expect(config.twilioSmsFromNumber).toBe('+15550001111');
    expect(config.twilioWhatsappFromNumber).toBe('+15550002222');
    expect(config.twilioWhatsappContentSids).toEqual({ 'consent_request:en': 'HX1', checkin_daily: 'HX2' });
    expect(config.twilioVoiceFromNumber).toBe('+15550003333');
    expect(config.voiceAudioBaseUrl).toBe('https://cdn.nearby.test/voice');
    expect(config.port).toBe(4000);
  });

  it('boots without SUPABASE_SERVICE_ROLE_KEY and exposes no getter for it (CB-025)', () => {
    const config = new AppConfigService(validEnv());

    expect(config.supabaseAnonKey).toBe('anon-key');
    expect('supabaseServiceRoleKey' in config).toBe(false);
    // A key still present in an older `.env` is accepted and ignored.
    expect(() => new AppConfigService(validEnv({ SUPABASE_SERVICE_ROLE_KEY: 'stale-service-role-key' }))).not.toThrow();
  });

  it('ignores the removed provider variables so a stale .env still boots (CB-019, CB-021, CB-022)', () => {
    const config = new AppConfigService(
      validEnv({
        SMS_PROVIDER_API_KEY: 'sms-key',
        SMS_PROVIDER_FROM_NUMBER: '+15550009999',
        WHATSAPP_ACCESS_TOKEN: 'meta-token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
        CHANNEL_WEBHOOK_SECRET: 'provider-webhook-secret',
        VOICE_PROVIDER_API_KEY: 'voice-key',
        VOICE_PROVIDER_FROM_NUMBER: '+15550008888',
      }),
    );

    for (const removed of [
      'smsProviderApiKey',
      'smsProviderFromNumber',
      'whatsappAccessToken',
      'whatsappPhoneNumberId',
      'channelWebhookSecret',
      'voiceProviderApiKey',
      'voiceProviderFromNumber',
    ]) {
      expect(removed in config, removed).toBe(false);
    }
  });

  describe('TWILIO_WHATSAPP_CONTENT_SIDS (CB-020)', () => {
    it('is undefined when absent or blank, in either mode', () => {
      expect(
        new AppConfigService(validEnv({ CHANNEL_PROVIDER_MODE: 'fake' })).twilioWhatsappContentSids,
      ).toBeUndefined();
      expect(
        new AppConfigService(validEnv({ CHANNEL_PROVIDER_MODE: 'configured', TWILIO_WHATSAPP_CONTENT_SIDS: '  ' }))
          .twilioWhatsappContentSids,
      ).toBeUndefined();
    });

    it.each(['configured', 'fake'])(
      'fails boot in %s mode on malformed JSON with a message that names the variable',
      (mode) => {
        expect(
          () =>
            new AppConfigService(
              validEnv({ CHANNEL_PROVIDER_MODE: mode, TWILIO_WHATSAPP_CONTENT_SIDS: '{"consent_request:en": HX1}' }),
            ),
        ).toThrow(/Invalid backend environment: TWILIO_WHATSAPP_CONTENT_SIDS must be a JSON object .* not valid JSON/);
      },
    );

    it.each([
      ['an array', '["HX1"]', 'not a JSON object'],
      ['a string', '"HX1"', 'not a JSON object'],
      ['a numeric value', '{"consent_request:en": 1}', 'value for "consent_request:en" is not a non-empty string'],
      ['a blank value', '{"consent_request:en": " "}', 'value for "consent_request:en" is not a non-empty string'],
      ['a blank key', '{" ": "HX1"}', 'a key is blank'],
    ])('rejects %s', (_label, raw, reason) => {
      expect(() => parseTwilioWhatsappContentSids(raw)).toThrow(reason);
      expect(() => new AppConfigService(validEnv({ TWILIO_WHATSAPP_CONTENT_SIDS: raw }))).toThrow(
        'Invalid backend environment: TWILIO_WHATSAPP_CONTENT_SIDS',
      );
    });

    it('trims keys and values', () => {
      expect(parseTwilioWhatsappContentSids(' {" checkin_daily:ar ": " HX9 "} ')).toEqual({
        'checkin_daily:ar': 'HX9',
      });
    });
  });

  it('defaults blank RevenueCat entitlement ids to the Nearby entitlement', () => {
    const config = new AppConfigService(validEnv({ REVENUECAT_ENTITLEMENT_ID: '   ' }));

    expect(config.revenueCatEntitlementId).toBe('nearby_access');
  });

  it('trims configured RevenueCat entitlement ids', () => {
    const config = new AppConfigService(validEnv({ REVENUECAT_ENTITLEMENT_ID: '  premium_access  ' }));

    expect(config.revenueCatEntitlementId).toBe('premium_access');
  });

  it('rejects invalid or missing required environment variables', () => {
    expect(
      () =>
        new AppConfigService({
          DATABASE_URL: 'not-a-url',
          KMS_MASTER_KEY_BASE64: 'short',
          SUPABASE_URL: 'not-a-url',
          SUPABASE_ANON_KEY: '',
          OPERATIONS_CRON_SECRET: '',
        }),
    ).toThrow('Invalid backend environment');
  });

  it('defaults HTTP hardening settings', () => {
    const config = new AppConfigService(validEnv());

    expect(config.rateLimitTtlSeconds).toBe(60);
    expect(config.rateLimitMaxRequests).toBe(300);
    expect(config.trustProxy).toBeUndefined();
    expect(config.corsAllowedOrigins).toEqual([]);
  });

  it('parses rate limit settings as positive integers', () => {
    const config = new AppConfigService(validEnv({ RATE_LIMIT_TTL_SECONDS: '30', RATE_LIMIT_MAX_REQUESTS: '10' }));

    expect(config.rateLimitTtlSeconds).toBe(30);
    expect(config.rateLimitMaxRequests).toBe(10);
  });

  it.each([
    ['RATE_LIMIT_TTL_SECONDS', '0'],
    ['RATE_LIMIT_TTL_SECONDS', '-1'],
    ['RATE_LIMIT_TTL_SECONDS', '1.5'],
    ['RATE_LIMIT_TTL_SECONDS', 'soon'],
    ['RATE_LIMIT_MAX_REQUESTS', '0'],
    ['RATE_LIMIT_MAX_REQUESTS', '-5'],
    ['RATE_LIMIT_MAX_REQUESTS', 'many'],
  ])('rejects non-positive or non-integer %s=%s', (key, value) => {
    expect(() => new AppConfigService(validEnv({ [key]: value }))).toThrow('Invalid backend environment');
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['true', true],
    ['TRUE', true],
    ['false', false],
    ['loopback', 'loopback'],
    ['loopback, linklocal', 'loopback, linklocal'],
    ['10.0.0.0/8', '10.0.0.0/8'],
    ['  10.0.0.1  ', '10.0.0.1'],
  ])('parses TRUST_PROXY=%s into an Express trust proxy value', (raw, expected) => {
    const config = new AppConfigService(validEnv({ TRUST_PROXY: raw }));

    expect(config.trustProxy).toBe(expected);
  });

  it('treats a blank TRUST_PROXY as unset', () => {
    const config = new AppConfigService(validEnv({ TRUST_PROXY: '   ' }));

    expect(config.trustProxy).toBeUndefined();
  });

  it('parses CORS_ALLOWED_ORIGINS as a trimmed comma-separated list without empty entries', () => {
    const config = new AppConfigService(
      validEnv({ CORS_ALLOWED_ORIGINS: ' https://admin.nearby.test , ,https://app.nearby.test,' }),
    );

    expect(config.corsAllowedOrigins).toEqual(['https://admin.nearby.test', 'https://app.nearby.test']);
  });

  it('returns no CORS origins for a blank CORS_ALLOWED_ORIGINS', () => {
    const config = new AppConfigService(validEnv({ CORS_ALLOWED_ORIGINS: '  ,  ' }));

    expect(config.corsAllowedOrigins).toEqual([]);
  });

  it('exposes SUPABASE_JWT_SECRET only when set and non-blank (CB-024)', () => {
    expect(new AppConfigService(validEnv()).supabaseJwtSecret).toBeUndefined();
    expect(new AppConfigService(validEnv({ SUPABASE_JWT_SECRET: 'legacy-jwt-secret' })).supabaseJwtSecret).toBe(
      'legacy-jwt-secret',
    );
    expect(() => new AppConfigService(validEnv({ SUPABASE_JWT_SECRET: '' }))).toThrow('Invalid backend environment');
  });

  it('exposes a trimmed EXPO_ACCESS_TOKEN and treats a blank one as unset (CB-023)', () => {
    expect(new AppConfigService(validEnv({ EXPO_ACCESS_TOKEN: '  expo-secret  ' })).expoAccessToken).toBe(
      'expo-secret',
    );
    expect(new AppConfigService(validEnv({ EXPO_ACCESS_TOKEN: '   ' })).expoAccessToken).toBeUndefined();
    expect(new AppConfigService(validEnv()).expoAccessToken).toBeUndefined();
  });
});
