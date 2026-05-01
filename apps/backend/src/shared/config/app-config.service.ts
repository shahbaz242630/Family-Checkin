import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  KMS_MASTER_KEY_BASE64: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPERATIONS_CRON_SECRET: z.string().min(1),
  CHANNEL_PROVIDER_MODE: z.enum(['configured', 'fake']).default('configured'),
  SMS_PROVIDER_API_KEY: z.string().optional(),
  SMS_PROVIDER_FROM_NUMBER: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  CHANNEL_WEBHOOK_SECRET: z.string().optional(),
  VOICE_PROVIDER_API_KEY: z.string().optional(),
  VOICE_PROVIDER_FROM_NUMBER: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
});

export type BackendEnv = Record<string, string | undefined>;

@Injectable()
export class AppConfigService {
  private readonly env: z.infer<typeof envSchema>;

  constructor(source: BackendEnv = process.env) {
    const parsed = envSchema.safeParse(source);

    if (!parsed.success) {
      throw new Error(`Invalid backend environment: ${z.prettifyError(parsed.error)}`);
    }

    const kmsMasterKey = Buffer.from(parsed.data.KMS_MASTER_KEY_BASE64, 'base64');
    if (kmsMasterKey.length !== 32) {
      throw new Error('Invalid backend environment: KMS_MASTER_KEY_BASE64 must decode to 32 bytes');
    }

    this.env = parsed.data;
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

  get supabaseServiceRoleKey(): string {
    return this.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  get operationsCronSecret(): string {
    return this.env.OPERATIONS_CRON_SECRET;
  }

  get channelProviderMode(): 'configured' | 'fake' {
    return this.env.CHANNEL_PROVIDER_MODE;
  }

  get smsProviderApiKey(): string | undefined {
    return this.env.SMS_PROVIDER_API_KEY;
  }

  get smsProviderFromNumber(): string | undefined {
    return this.env.SMS_PROVIDER_FROM_NUMBER;
  }

  get whatsappAccessToken(): string | undefined {
    return this.env.WHATSAPP_ACCESS_TOKEN;
  }

  get whatsappPhoneNumberId(): string | undefined {
    return this.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  get channelWebhookSecret(): string | undefined {
    return this.env.CHANNEL_WEBHOOK_SECRET;
  }

  get voiceProviderApiKey(): string | undefined {
    return this.env.VOICE_PROVIDER_API_KEY;
  }

  get voiceProviderFromNumber(): string | undefined {
    return this.env.VOICE_PROVIDER_FROM_NUMBER;
  }

  get port(): number {
    return this.env.PORT ?? 3000;
  }
}
