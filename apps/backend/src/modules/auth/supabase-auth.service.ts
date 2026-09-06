import {
  HttpException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createLocalJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify } from 'jose';
import type { JSONWebKeySet, JWTPayload, JWTVerifyOptions } from 'jose';
import { AppConfigService } from '../../shared/config/app-config.service';
import { isSupportedTimeZone } from '../../shared/schedule/receiver-schedule';

export interface SupabaseSenderIdentity {
  authProviderId: string;
  email: string;
  /**
   * The `phone` claim (GoTrue's E.164 digits, given back their `+`) or `user_metadata.phone` as the client wrote
   * it; absent when the token carries neither. `UsersService` normalises it and decides whether it is required.
   */
  phone?: string;
  /** `user_metadata.full_name`, falling back to `user_metadata.name`; absent when neither is a non-blank string. */
  displayName?: string;
  /** ISO 3166-1 alpha-2, upper-cased; `AE` when the metadata value is missing or malformed. */
  country: string;
  /** Lower-cased BCP 47-shaped code of at most 8 characters (`users.preferredLanguage`); `en` otherwise. */
  preferredLanguage: string;
  /** An IANA zone the platform can evaluate; `Asia/Dubai` otherwise. */
  timezone: string;
}

/** The claims GoTrue puts in a user access token, typed loosely because `user_metadata` is client-writable. */
interface SupabaseAccessTokenClaims extends JWTPayload {
  role?: unknown;
  email?: unknown;
  phone?: unknown;
  user_metadata?: unknown;
}

type Fetch = typeof fetch;

/** Metadata defaults, shared with `UsersService` through the identity so the two never disagree. */
export const DEFAULT_SENDER_COUNTRY = 'AE';
export const DEFAULT_SENDER_LANGUAGE = 'en';
export const DEFAULT_SENDER_TIMEZONE = 'Asia/Dubai';

const AUTHENTICATED_AUDIENCE = 'authenticated';
const AUTHENTICATED_ROLE = 'authenticated';
const SYMMETRIC_ALGORITHM = 'HS256';
/** The signing algorithms Supabase offers for asymmetric project keys (ECC P-256 and RSA 2048). */
const ASYMMETRIC_ALGORITHMS: readonly string[] = ['ES256', 'RS256'];
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
/** Allowed clock drift between the backend and Supabase Auth when checking `exp` / `nbf` / `iat`. */
const CLOCK_TOLERANCE_SECONDS = 30;
/** A cached key set older than this is refreshed lazily on the next request, so a revoked key stops working. */
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
/** An unknown `kid` triggers at most one refetch per cooldown, so forged tokens cannot make the backend hammer Supabase. */
const JWKS_UNKNOWN_KID_COOLDOWN_MS = 30 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
/** `users.preferredLanguage` is `varchar(8)` (CB-075). */
const MAX_LANGUAGE_LENGTH = 8;

@Injectable()
export class SupabaseAuthService {
  private keySet?: { keys: JSONWebKeySet; fetchedAt: number };
  private keySetFetch?: Promise<JSONWebKeySet>;

  constructor(
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'supabaseUrl' | 'supabaseJwtSecret'>,
    @Optional() private readonly fetchFn: Fetch = fetch,
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Verifies a Supabase access token locally (CB-024): the signature against the project's legacy HS256 secret
   * when `SUPABASE_JWT_SECRET` is set and the token uses it, otherwise against the project's published JWKS
   * (cached in memory, refreshed once on an unknown `kid`); then `exp` (with a small clock tolerance), `iss`,
   * `aud` and `role`. The identity comes from the claims alone, so a normal request never calls Supabase.
   * An invalid or expired token is 401; a JWKS that cannot be fetched is 503.
   */
  async verifyAccessToken(accessToken: string): Promise<SupabaseSenderIdentity> {
    const token = accessToken.trim();
    if (!token) {
      throw new UnauthorizedException('Invalid Supabase access token');
    }

    let claims: SupabaseAccessTokenClaims;
    try {
      claims = await this.verifyClaims(token);
    } catch (error) {
      throw this.toHttpException(error);
    }

    if (claims.role !== AUTHENTICATED_ROLE) {
      throw new UnauthorizedException('Supabase access token is not an authenticated user session');
    }

    return this.toSenderIdentity(claims);
  }

  private async verifyClaims(token: string): Promise<SupabaseAccessTokenClaims> {
    const { alg } = decodeProtectedHeader(token);
    const options: JWTVerifyOptions = {
      issuer: `${this.config.supabaseUrl}/auth/v1`,
      audience: AUTHENTICATED_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['exp', 'sub'],
    };

    if (alg === SYMMETRIC_ALGORITHM) {
      const secret = this.config.supabaseJwtSecret;
      if (!secret) {
        throw new UnauthorizedException('Supabase access token uses HS256 but SUPABASE_JWT_SECRET is not set');
      }
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        ...options,
        algorithms: [SYMMETRIC_ALGORITHM],
      });
      return payload;
    }

    if (!alg || !ASYMMETRIC_ALGORITHMS.includes(alg)) {
      // `none`, an HMAC variant or anything Supabase does not sign with: rejected before any key is looked up.
      throw new UnauthorizedException('Invalid Supabase access token');
    }

    return this.verifyWithKeySet(token, { ...options, algorithms: [...ASYMMETRIC_ALGORITHMS] });
  }

  private async verifyWithKeySet(token: string, options: JWTVerifyOptions): Promise<SupabaseAccessTokenClaims> {
    const keys = await this.currentKeySet();
    try {
      return (await jwtVerify(token, createLocalJWKSet(keys), options)).payload;
    } catch (error) {
      if (!(error instanceof joseErrors.JWKSNoMatchingKey) || !this.mayRefreshForUnknownKid()) {
        throw error;
      }
    }

    // A `kid` the cache has never seen: Supabase rotated or added a signing key. Refetch once and judge the token
    // on the fresh set; a second miss is a token for a key this project does not have.
    const refreshed = await this.refreshKeySet();
    return (await jwtVerify(token, createLocalJWKSet(refreshed), options)).payload;
  }

  private async currentKeySet(): Promise<JSONWebKeySet> {
    if (this.keySet && this.now() - this.keySet.fetchedAt < JWKS_CACHE_MAX_AGE_MS) {
      return this.keySet.keys;
    }

    try {
      return await this.refreshKeySet();
    } catch (error) {
      // Keys rotate rarely: a stale set beats failing every request while Supabase is briefly unreachable.
      if (this.keySet) {
        return this.keySet.keys;
      }
      throw error;
    }
  }

  private mayRefreshForUnknownKid(): boolean {
    return !this.keySet || this.now() - this.keySet.fetchedAt >= JWKS_UNKNOWN_KID_COOLDOWN_MS;
  }

  /** One in-flight fetch at a time; concurrent first requests share it. */
  private refreshKeySet(): Promise<JSONWebKeySet> {
    this.keySetFetch ??= this.fetchKeySet()
      .then((keys) => {
        this.keySet = { keys, fetchedAt: this.now() };
        return keys;
      })
      .finally(() => {
        this.keySetFetch = undefined;
      });

    return this.keySetFetch;
  }

  private async fetchKeySet(): Promise<JSONWebKeySet> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.supabaseUrl}${JWKS_PATH}`, {
        signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('Supabase Auth key set is unreachable');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`Supabase Auth key set responded with HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException('Supabase Auth key set response is not JSON');
    }
    if (!isJsonWebKeySet(body)) {
      throw new ServiceUnavailableException('Supabase Auth key set response is malformed');
    }

    return body;
  }

  private toHttpException(error: unknown): unknown {
    if (error instanceof HttpException) {
      return error;
    }
    if (error instanceof joseErrors.JWKSInvalid) {
      return new ServiceUnavailableException('Supabase Auth key set is malformed');
    }
    if (error instanceof joseErrors.JWTExpired) {
      return new UnauthorizedException('Supabase access token has expired');
    }
    // Every other jose error (bad signature, wrong issuer or audience, unknown key, malformed token) and a token
    // that is not a JWS at all (`decodeProtectedHeader` throws a TypeError) mean the token is not acceptable.
    if (error instanceof joseErrors.JOSEError || error instanceof TypeError) {
      return new UnauthorizedException('Invalid Supabase access token');
    }

    return error;
  }

  private toSenderIdentity(claims: SupabaseAccessTokenClaims): SupabaseSenderIdentity {
    const authProviderId = nonBlankString(claims.sub);
    if (!authProviderId) {
      throw new UnauthorizedException('Supabase user is missing an id');
    }
    const email = nonBlankString(claims.email);
    if (!email) {
      throw new UnauthorizedException('Supabase user is missing an email');
    }

    const metadata = isRecord(claims.user_metadata) ? claims.user_metadata : {};
    const phone = phoneFromAuthClaim(claims.phone) ?? nonBlankString(metadata.phone);
    const displayName = nonBlankString(metadata.full_name) ?? nonBlankString(metadata.name);

    return {
      authProviderId,
      email,
      ...(phone ? { phone } : {}),
      ...(displayName ? { displayName } : {}),
      country: countryOrDefault(metadata.country),
      preferredLanguage: languageOrDefault(metadata.preferred_language),
      timezone: timezoneOrDefault(metadata.timezone),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonWebKeySet(value: unknown): value is JSONWebKeySet {
  return isRecord(value) && Array.isArray(value.keys) && value.keys.every(isRecord);
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** GoTrue stores a verified phone as E.164 digits without the `+` (`971501234567`); anything else is passed through. */
function phoneFromAuthClaim(value: unknown): string | undefined {
  const phone = nonBlankString(value);
  if (!phone) {
    return undefined;
  }
  return /^\d{6,15}$/.test(phone) ? `+${phone}` : phone;
}

function countryOrDefault(value: unknown): string {
  const country = nonBlankString(value);
  return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : DEFAULT_SENDER_COUNTRY;
}

function languageOrDefault(value: unknown): string {
  const language = nonBlankString(value)?.toLowerCase();
  return language && language.length <= MAX_LANGUAGE_LENGTH && /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(language)
    ? language
    : DEFAULT_SENDER_LANGUAGE;
}

function timezoneOrDefault(value: unknown): string {
  const timezone = nonBlankString(value);
  return timezone && isSupportedTimeZone(timezone) ? timezone : DEFAULT_SENDER_TIMEZONE;
}
