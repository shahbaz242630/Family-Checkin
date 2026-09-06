import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';

export interface SupabaseSenderIdentity {
  authProviderId: string;
  email: string;
  phone: string;
  /** `user_metadata.full_name`, falling back to `user_metadata.name`; absent when neither is a non-blank string. */
  displayName?: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

interface SupabaseUserResponse {
  id?: unknown;
  email?: unknown;
  phone?: unknown;
  user_metadata?: {
    phone?: unknown;
    full_name?: unknown;
    name?: unknown;
    country?: unknown;
    preferred_language?: unknown;
    timezone?: unknown;
  };
}

type Fetch = typeof fetch;

@Injectable()
export class SupabaseAuthService {
  constructor(
    @Inject(AppConfigService)
    private readonly config: AppConfigService,
    @Optional() private readonly fetchFn: Fetch = fetch,
  ) {}

  async verifyAccessToken(accessToken: string): Promise<SupabaseSenderIdentity> {
    const response = await this.fetchFn(`${this.config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: this.config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException('Invalid Supabase access token');
    }

    const user = (await response.json()) as SupabaseUserResponse;
    return this.toSenderIdentity(user);
  }

  private toSenderIdentity(user: SupabaseUserResponse): SupabaseSenderIdentity {
    if (typeof user.id !== 'string' || !user.id) {
      throw new UnauthorizedException('Supabase user is missing an id');
    }
    if (typeof user.email !== 'string' || !user.email) {
      throw new UnauthorizedException('Supabase user is missing an email');
    }
    const phone = this.stringMetadata(user.phone, this.stringMetadata(user.user_metadata?.phone, ''));
    if (!phone) {
      throw new UnauthorizedException('Supabase user is missing a phone number');
    }

    const displayName = this.stringMetadata(
      user.user_metadata?.full_name,
      this.stringMetadata(user.user_metadata?.name, ''),
    );

    return {
      authProviderId: user.id,
      email: user.email,
      phone,
      ...(displayName ? { displayName } : {}),
      country: this.stringMetadata(user.user_metadata?.country, 'AE'),
      preferredLanguage: this.stringMetadata(user.user_metadata?.preferred_language, 'en'),
      timezone: this.stringMetadata(user.user_metadata?.timezone, 'Asia/Dubai'),
    };
  }

  private stringMetadata(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }
}
