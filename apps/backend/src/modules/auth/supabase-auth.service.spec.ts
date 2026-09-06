import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JSONWebKeySet, JWK, KeyLike } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthService } from './supabase-auth.service';

const SUPABASE_URL = 'https://nearby-test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const JWT_SECRET = 'legacy-supabase-jwt-secret-with-plenty-of-entropy-0123456789';
const SUBJECT = 'supabase-user-123';
const T0 = Date.parse('2026-09-06T10:00:00.000Z');

/** What GoTrue puts in an email-password sender's token, phone included only in the client-written metadata. */
const senderClaims = {
  role: 'authenticated',
  email: 'sender@example.com',
  user_metadata: {
    phone: '+971501234567',
    country: 'AE',
    preferred_language: 'en',
    timezone: 'Asia/Dubai',
  },
};

const expectedIdentity = {
  authProviderId: SUBJECT,
  email: 'sender@example.com',
  phone: '+971501234567',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

interface SigningKey {
  kid: string;
  alg: 'ES256' | 'RS256';
  privateKey: KeyLike;
  publicJwk: JWK;
}

interface SignOptions {
  key?: SigningKey;
  secret?: string;
  /** Seconds from now; negative for an already expired token. */
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  subject?: string | null;
}

let ecKey: SigningKey;
let rsaKey: SigningKey;
let rotatedKey: SigningKey;

async function signingKey(kid: string, alg: 'ES256' | 'RS256'): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg);
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
  return { kid, alg, privateKey, publicJwk };
}

beforeAll(async () => {
  [ecKey, rsaKey, rotatedKey] = await Promise.all([
    signingKey('ec-key-1', 'ES256'),
    signingKey('rsa-key-1', 'RS256'),
    signingKey('ec-key-2', 'ES256'),
  ]);
});

async function sign(claims: Record<string, unknown>, options: SignOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const builder = new SignJWT(claims)
    .setIssuedAt(nowSeconds)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? 'authenticated')
    .setExpirationTime(nowSeconds + (options.expiresInSeconds ?? 3600));
  if (options.subject !== null) {
    builder.setSubject(options.subject ?? SUBJECT);
  }

  if (options.secret !== undefined) {
    return builder.setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(options.secret));
  }
  const key = options.key ?? ecKey;
  return builder.setProtectedHeader({ alg: key.alg, kid: key.kid }).sign(key.privateKey);
}

function jwksResponse(keys: SigningKey[], status = 200) {
  const body: JSONWebKeySet = { keys: keys.map((key) => key.publicJwk) };
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function jwksFetch(...responses: Array<ReturnType<typeof jwksResponse> | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) {
      fetchMock.mockRejectedValueOnce(response);
    } else {
      fetchMock.mockResolvedValueOnce(response);
    }
  }
  return fetchMock;
}

function serviceWith(options: { secret?: string; fetchMock?: ReturnType<typeof vi.fn>; now?: () => number } = {}) {
  const fetchMock = options.fetchMock ?? vi.fn();
  const service = new SupabaseAuthService(
    { supabaseUrl: SUPABASE_URL, supabaseJwtSecret: options.secret },
    fetchMock as unknown as typeof fetch,
    options.now ?? (() => T0),
  );
  return { service, fetchMock };
}

describe('SupabaseAuthService verifies access tokens locally (CB-024)', () => {
  describe('with the legacy HS256 project secret', () => {
    it('accepts a token signed with SUPABASE_JWT_SECRET without any network call', async () => {
      const { service, fetchMock } = serviceWith({ secret: JWT_SECRET });

      const identity = await service.verifyAccessToken(await sign(senderClaims, { secret: JWT_SECRET }));

      expect(identity).toEqual(expectedIdentity);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a token signed with a different secret', async () => {
      const { service } = serviceWith({ secret: JWT_SECRET });

      await expect(
        service.verifyAccessToken(await sign(senderClaims, { secret: 'not-the-project-secret' })),
      ).rejects.toThrow(new UnauthorizedException('Invalid Supabase access token'));
    });

    it('rejects an HS256 token when no secret is configured, naming the missing variable', async () => {
      const { service, fetchMock } = serviceWith();

      await expect(service.verifyAccessToken(await sign(senderClaims, { secret: JWT_SECRET }))).rejects.toThrow(
        new UnauthorizedException('Supabase access token uses HS256 but SUPABASE_JWT_SECRET is not set'),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('with the project JWKS', () => {
    it('fetches the key set once, verifies ES256 and RS256 tokens against it and serves later tokens from memory', async () => {
      const { service, fetchMock } = serviceWith({ fetchMock: jwksFetch(jwksResponse([ecKey, rsaKey])) });

      await expect(service.verifyAccessToken(await sign(senderClaims, { key: ecKey }))).resolves.toEqual(
        expectedIdentity,
      );
      await expect(service.verifyAccessToken(await sign(senderClaims, { key: rsaKey }))).resolves.toEqual(
        expectedIdentity,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(JWKS_URL, { signal: expect.any(AbortSignal) });
    });

    it('verifies asymmetric tokens through the JWKS even while the legacy secret is still configured', async () => {
      const { service, fetchMock } = serviceWith({ secret: JWT_SECRET, fetchMock: jwksFetch(jwksResponse([ecKey])) });

      await expect(service.verifyAccessToken(await sign(senderClaims, { key: ecKey }))).resolves.toEqual(
        expectedIdentity,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('shares one fetch between concurrent first requests', async () => {
      const { service, fetchMock } = serviceWith({ fetchMock: jwksFetch(jwksResponse([ecKey])) });
      const token = await sign(senderClaims, { key: ecKey });

      const identities = await Promise.all([service.verifyAccessToken(token), service.verifyAccessToken(token)]);

      expect(identities).toEqual([expectedIdentity, expectedIdentity]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches once for a kid the cache does not know and accepts the token when the new set carries it', async () => {
      let now = T0;
      const { service, fetchMock } = serviceWith({
        fetchMock: jwksFetch(jwksResponse([ecKey]), jwksResponse([ecKey, rotatedKey])),
        now: () => now,
      });
      await service.verifyAccessToken(await sign(senderClaims, { key: ecKey }));

      now += 31_000;
      await expect(service.verifyAccessToken(await sign(senderClaims, { key: rotatedKey }))).resolves.toEqual(
        expectedIdentity,
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a token for a kid the project does not have and refetches at most once per cooldown', async () => {
      let now = T0;
      const { service, fetchMock } = serviceWith({
        fetchMock: jwksFetch(jwksResponse([ecKey]), jwksResponse([ecKey]), jwksResponse([ecKey])),
        now: () => now,
      });
      const foreign = await sign(senderClaims, { key: rotatedKey });

      // Fresh cache: the miss is reported without a second round trip.
      await expect(service.verifyAccessToken(foreign)).rejects.toThrow(UnauthorizedException);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Past the cooldown: one refetch, still a miss, still 401.
      now += 31_000;
      await expect(service.verifyAccessToken(foreign)).rejects.toThrow(UnauthorizedException);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Inside the cooldown again: no further round trip for the same forged kid.
      await expect(service.verifyAccessToken(foreign)).rejects.toThrow(UnauthorizedException);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes a key set older than ten minutes and keeps the stale one when the refresh fails', async () => {
      let now = T0;
      const { service, fetchMock } = serviceWith({
        fetchMock: jwksFetch(jwksResponse([ecKey]), new Error('ECONNRESET'), jwksResponse([ecKey, rotatedKey])),
        now: () => now,
      });
      await service.verifyAccessToken(await sign(senderClaims, { key: ecKey }));

      now += 11 * 60_000;
      await expect(service.verifyAccessToken(await sign(senderClaims, { key: ecKey }))).resolves.toEqual(
        expectedIdentity,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);

      now += 11 * 60_000;
      await expect(service.verifyAccessToken(await sign(senderClaims, { key: rotatedKey }))).resolves.toEqual(
        expectedIdentity,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['a network failure', new Error('fetch failed')],
      ['a 5xx from Supabase', jwksResponse([], 503)],
      [
        'a body that is not JSON',
        {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('bad json');
          },
        },
      ],
      ['a body without keys', { ok: true, status: 200, json: async () => ({ message: 'not a key set' }) }],
    ])('answers 503, never 401, when the key set cannot be loaded because of %s', async (_label, response) => {
      const { service } = serviceWith({ fetchMock: jwksFetch(response as ReturnType<typeof jwksResponse>) });

      await expect(service.verifyAccessToken(await sign(senderClaims, { key: ecKey }))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('claims', () => {
    it('rejects an expired token but tolerates a small clock skew', async () => {
      const { service } = serviceWith({ secret: JWT_SECRET });

      await expect(
        service.verifyAccessToken(await sign(senderClaims, { secret: JWT_SECRET, expiresInSeconds: -120 })),
      ).rejects.toThrow(new UnauthorizedException('Supabase access token has expired'));
      await expect(
        service.verifyAccessToken(await sign(senderClaims, { secret: JWT_SECRET, expiresInSeconds: -20 })),
      ).resolves.toEqual(expectedIdentity);
    });

    it.each([
      ['another issuer', { issuer: 'https://other-project.supabase.co/auth/v1' }],
      ['another audience', { audience: 'anon' }],
      ['no subject', { subject: null }],
    ])('rejects a token with %s', async (_label, options) => {
      const { service } = serviceWith({ secret: JWT_SECRET });

      await expect(
        service.verifyAccessToken(await sign(senderClaims, { secret: JWT_SECRET, ...options })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose role is not authenticated, such as a service-role or anon key', async () => {
      const { service } = serviceWith({ secret: JWT_SECRET });

      await expect(
        service.verifyAccessToken(await sign({ ...senderClaims, role: 'service_role' }, { secret: JWT_SECRET })),
      ).rejects.toThrow(new UnauthorizedException('Supabase access token is not an authenticated user session'));
    });

    it('rejects an unsigned or malformed token before looking up any key', async () => {
      const { service, fetchMock } = serviceWith({ secret: JWT_SECRET });
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub: SUBJECT, role: 'authenticated', exp: 4_102_444_800 }),
      ).toString('base64url')}.`;

      await expect(service.verifyAccessToken(unsigned)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyAccessToken('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyAccessToken('   ')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires an email on the token', async () => {
      const { service } = serviceWith({ secret: JWT_SECRET });

      await expect(
        service.verifyAccessToken(await sign({ ...senderClaims, email: undefined }, { secret: JWT_SECRET })),
      ).rejects.toThrow(new UnauthorizedException('Supabase user is missing an email'));
    });
  });

  describe('identity from the claims', () => {
    const identityFor = async (claims: Record<string, unknown>) => {
      const { service } = serviceWith({ secret: JWT_SECRET });
      return service.verifyAccessToken(await sign({ role: 'authenticated', ...claims }, { secret: JWT_SECRET }));
    };

    it('prefers the phone claim GoTrue verified, restoring its + sign, over the client-written metadata phone', async () => {
      expect((await identityFor({ ...senderClaims, phone: '971509999999' })).phone).toBe('+971509999999');
      expect((await identityFor({ ...senderClaims, phone: '' })).phone).toBe('+971501234567');
      expect((await identityFor({ ...senderClaims, phone: '+44 7700 900123' })).phone).toBe('+44 7700 900123');
    });

    it('omits the phone instead of failing when the token carries none, and leaves the shape to UsersService', async () => {
      expect(await identityFor({ role: 'authenticated', email: 'sender@example.com' })).not.toHaveProperty('phone');
      expect((await identityFor({ ...senderClaims, user_metadata: { phone: 'call me' } })).phone).toBe('call me');
    });

    it('falls back to safe defaults for garbage country, language and timezone metadata instead of failing', async () => {
      const garbage = await identityFor({
        ...senderClaims,
        user_metadata: {
          phone: '+971501234567',
          country: 'United Arab Emirates',
          preferred_language: 'English (UK)',
          timezone: 'Dubai',
        },
      });
      expect(garbage).toMatchObject({ country: 'AE', preferredLanguage: 'en', timezone: 'Asia/Dubai' });

      const typed = await identityFor({
        ...senderClaims,
        user_metadata: { phone: '+971501234567', country: 42, preferred_language: ['ar'], timezone: null },
      });
      expect(typed).toMatchObject({ country: 'AE', preferredLanguage: 'en', timezone: 'Asia/Dubai' });

      const missing = await identityFor({ ...senderClaims, user_metadata: 'not an object' });
      expect(missing).toMatchObject({ country: 'AE', preferredLanguage: 'en', timezone: 'Asia/Dubai' });
    });

    it('normalises well-formed country, language and timezone metadata', async () => {
      const identity = await identityFor({
        ...senderClaims,
        user_metadata: {
          phone: '+447700900123',
          country: 'gb',
          preferred_language: ' AR ',
          timezone: 'Europe/London',
        },
      });

      expect(identity).toMatchObject({ country: 'GB', preferredLanguage: 'ar', timezone: 'Europe/London' });
      expect(
        (await identityFor({ ...senderClaims, user_metadata: { preferred_language: 'pt-BR' } })).preferredLanguage,
      ).toBe('pt-br');
      expect(
        (await identityFor({ ...senderClaims, user_metadata: { preferred_language: 'zh-Hant-TW' } })).preferredLanguage,
      ).toBe('en');
    });

    it('carries the display name from full_name, falling back to name, and omits it when neither is set (CB-010)', async () => {
      const withMetadata = (user_metadata: Record<string, unknown>) =>
        identityFor({ ...senderClaims, user_metadata: { ...senderClaims.user_metadata, ...user_metadata } });

      expect((await withMetadata({ full_name: 'Sam Malik', name: 'sam' })).displayName).toBe('Sam Malik');
      expect((await withMetadata({ name: 'Sam' })).displayName).toBe('Sam');
      expect(await withMetadata({ full_name: '   ', name: 42 })).not.toHaveProperty('displayName');
    });
  });
});
