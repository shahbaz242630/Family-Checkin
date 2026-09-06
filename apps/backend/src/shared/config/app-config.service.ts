import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

const channelProviderModeSchema = z.enum(['configured', 'fake']).default('configured');

// `z.object` strips keys it does not list, so a variable this schema no longer reads (SMS_PROVIDER_*,
// VOICE_PROVIDER_*, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, CHANNEL_WEBHOOK_SECRET — removed by
// CB-019, CB-021 and CB-022) left behind in someone's `.env` is ignored, never a boot failure.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  KMS_MASTER_KEY_BASE64: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Accepted so an existing `.env` still boots, but never read: the backend authorises through RLS and its own
  // database connection and must not call the Supabase admin API (founder decision 2026-09-06, CB-025).
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  OPERATIONS_CRON_SECRET: z.string().min(1),
  PUBLIC_API_BASE_URL: z.string().url().optional(),
  CHANNEL_PROVIDER_MODE: channelProviderModeSchema,
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_SMS_FROM_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_FROM_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_CONTENT_SIDS: z.string().optional(),
  TWILIO_VOICE_FROM_NUMBER: z.string().optional(),
  VOICE_AUDIO_BASE_URL: z.string().url().optional(),
  REVENUECAT_WEBHOOK_AUTH_TOKEN: z.string().optional(),
  REVENUECAT_ENTITLEMENT_ID: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),
  TRUST_PROXY: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type BackendEnv = Record<string, string | undefined>;
export type TrustProxySetting = boolean | number | string;
export type ChannelProviderMode = z.infer<typeof channelProviderModeSchema>;

/**
 * Reads only `CHANNEL_PROVIDER_MODE`, for wiring that must be decided before the DI container exists (which
 * controllers a module registers). Same parsing and default as `AppConfigService.channelProviderMode`.
 */
export function channelProviderModeFromEnv(source: BackendEnv = process.env): ChannelProviderMode {
  const parsed = channelProviderModeSchema.safeParse(source.CHANNEL_PROVIDER_MODE);

  if (!parsed.success) {
    throw new Error('Invalid backend environment: CHANNEL_PROVIDER_MODE must be "configured" or "fake"');
  }

  return parsed.data;
}

const CONTENT_SIDS_HINT =
  'TWILIO_WHATSAPP_CONTENT_SIDS must be a JSON object mapping "templateKey:language" (or "templateKey") to the ' +
  'approved Twilio Content SID, for example {"consent_request:en":"HX..."} (docs/providers/whatsapp.md)';

/**
 * Parses `TWILIO_WHATSAPP_CONTENT_SIDS` once, at boot (CB-020). A malformed value is a configuration mistake in
 * either mode and the boot error is the earliest place the founder can see it; an absent value is fine because
 * every `TWILIO_*` variable is optional and the WhatsApp provider throws at first use instead.
 */
export function parseTwilioWhatsappContentSids(raw: string | undefined): Record<string, string> | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid backend environment: ${CONTENT_SIDS_HINT}; the value is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid backend environment: ${CONTENT_SIDS_HINT}; the value is not a JSON object`);
  }

  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    if (!key.trim()) {
      throw new Error(`Invalid backend environment: ${CONTENT_SIDS_HINT}; a key is blank`);
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `Invalid backend environment: ${CONTENT_SIDS_HINT}; the value for "${key}" is not a non-empty string`,
      );
    }
  }

  return Object.fromEntries(entries.map(([key, value]) => [key.trim(), (value as string).trim()]));
}

@Injectable()
export class AppConfigService {
  private readonly env: z.infer<typeof envSchema>;
  private readonly whatsappContentSids: Record<string, string> | undefined;

  // `@Optional()` because the emitted parameter type is `Object`, which the container can never supply; the
  // environment is read directly. Specs pass an explicit `source`.
  constructor(@Optional() source: BackendEnv = process.env) {
    const parsed = envSchema.safeParse(source);

    if (!parsed.success) {
      throw new Error(`Invalid backend environment: ${z.prettifyError(parsed.error)}`);
    }

    const kmsMasterKey = Buffer.from(parsed.data.KMS_MASTER_KEY_BASE64, 'base64');
    if (kmsMasterKey.length !== 32) {
      throw new Error('Invalid backend environment: KMS_MASTER_KEY_BASE64 must decode to 32 bytes');
    }

    this.env = parsed.data;
    this.whatsappContentSids = parseTwilioWhatsappContentSids(parsed.data.TWILIO_WHATSAPP_CONTENT_SIDS);
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get kmsMasterKey(): Buffer {
    return Buffer.from(this.env.KMS_MASTER_KEY_BASE64, 'base64');
  }

  get supabaseUrl(): string {
    return this.env.SUPABASE_URL.replace(/\/$/, '');
  }

  get supabaseAnonKey(): string {
    return this.env.SUPABASE_ANON_KEY;
  }

  get operationsCronSecret(): string {
    return this.env.OPERATIONS_CRON_SECRET;
  }

  get publicApiBaseUrl(): string | undefined {
    return this.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  }

  get channelProviderMode(): 'configured' | 'fake' {
    return this.env.CHANNEL_PROVIDER_MODE;
  }

  get twilioAccountSid(): string | undefined {
    return this.env.TWILIO_ACCOUNT_SID;
  }

  get twilioAuthToken(): string | undefined {
    return this.env.TWILIO_AUTH_TOKEN;
  }

  get twilioSmsFromNumber(): string | undefined {
    return this.env.TWILIO_SMS_FROM_NUMBER;
  }

  get twilioWhatsappFromNumber(): string | undefined {
    return this.env.TWILIO_WHATSAPP_FROM_NUMBER;
  }

  /** Approved WhatsApp Content SIDs keyed `templateKey:language` (or `templateKey`), parsed once at boot. */
  get twilioWhatsappContentSids(): Record<string, string> | undefined {
    return this.whatsappContentSids;
  }

  get twilioVoiceFromNumber(): string | undefined {
    return this.env.TWILIO_VOICE_FROM_NUMBER;
  }

  get voiceAudioBaseUrl(): string | undefined {
    return this.env.VOICE_AUDIO_BASE_URL?.replace(/\/$/, '');
  }

  get revenueCatWebhookAuthToken(): string | undefined {
    return this.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  }

  get revenueCatEntitlementId(): string {
    const entitlementId = this.env.REVENUECAT_ENTITLEMENT_ID?.trim();
    return entitlementId || 'nearby_access';
  }

  get port(): number {
    return this.env.PORT ?? 3000;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMaxRequests(): number {
    return this.env.RATE_LIMIT_MAX_REQUESTS;
  }

  /**
   * Express `trust proxy` setting. Environment values are strings, so the two forms Express
   * cannot accept as strings are converted: `true`/`false` become booleans and a bare integer
   * becomes a hop count. Everything else (`loopback`, a CIDR, a comma-separated list) is passed
   * through verbatim for Express to interpret.
   */
  get trustProxy(): TrustProxySetting | undefined {
    const raw = this.env.TRUST_PROXY?.trim();
    if (!raw) {
      return undefined;
    }

    const lowered = raw.toLowerCase();
    if (lowered === 'true') {
      return true;
    }
    if (lowered === 'false') {
      return false;
    }
    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }

    return raw;
  }

  get corsAllowedOrigins(): string[] {
    return (this.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  /**
   * The Supabase project's legacy JWT secret, used to verify HS256-signed access tokens locally (CB-024). Unset on
   * a project that signs with asymmetric keys: those tokens are verified against the project's published JWKS.
   */
  get supabaseJwtSecret(): string | undefined {
    return this.env.SUPABASE_JWT_SECRET?.trim() || undefined;
  }

  /** Optional Expo access token sent as a bearer to the push API; blank means unauthenticated sends (CB-023). */
  get expoAccessToken(): string | undefined {
    return this.env.EXPO_ACCESS_TOKEN?.trim() || undefined;
  }
}
