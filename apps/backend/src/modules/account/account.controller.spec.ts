import { SensitiveAction } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { SupabaseAuthService } from '../auth/supabase-auth.service';
import type { UsersService } from '../users/users.service';
import type { SenderRecord } from '../users/users.repository';
import type { AccountPrivacyService } from './account-privacy.service';
import { AccountController } from './account.controller';
import type { StepUpService } from './step-up.service';

const cryptoService = new CryptoService(Buffer.alloc(32, 9));

const sender: SenderRecord = {
  id: 'user-1',
  authProviderId: 'auth-1',
  emailEncrypted: cryptoService.encrypt('sender@example.com'),
  emailHash: 'email-hash',
  phoneEncrypted: cryptoService.encrypt('+971501234567'),
  phoneHash: 'phone-hash',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

function controller() {
  const calls: unknown[] = [];

  return {
    calls,
    controller: new AccountController(
      {
        verifyAccessToken: async (token: string) => {
          calls.push({ verifyAccessToken: token });
          return {
            authProviderId: 'auth-1',
            email: 'sender@example.com',
            phone: '+971501234567',
            country: 'AE',
            preferredLanguage: 'en',
            timezone: 'Asia/Dubai',
          };
        },
      } as unknown as SupabaseAuthService,
      {
        upsertFromSupabaseIdentity: async () => {
          calls.push({ upsert: true });
          return sender;
        },
      } as unknown as UsersService,
      {
        requestStepUp: async (input: Parameters<StepUpService['requestStepUp']>[0]) => {
          calls.push({ requestStepUp: input });
          return { ok: true, challengeId: 'challenge-1', action: input.action, expiresAt: '2026-05-01T10:10:00.000Z' };
        },
        verifyStepUp: async (input: Parameters<StepUpService['verifyStepUp']>[0]) => {
          calls.push({ verifyStepUp: input });
          return { ok: true, stepUpToken: 'token-1', action: SensitiveAction.EXPORT_DATA, expiresAt: '2026-05-01T10:10:00.000Z' };
        },
      } as unknown as StepUpService,
      {
        exportAccount: async (input: Parameters<AccountPrivacyService['exportAccount']>[0]) => {
          calls.push({ exportAccount: input });
          return { exportedAt: '2026-05-01T10:00:00.000Z', exportVersion: '2026-05-01', user: { id: input.userId } };
        },
        deleteAccount: async (input: Parameters<AccountPrivacyService['deleteAccount']>[0]) => {
          calls.push({ deleteAccount: input });
          return { ok: true, deletedAt: '2026-05-01T10:00:00.000Z' };
        },
      } as unknown as AccountPrivacyService,
      cryptoService,
    ),
  };
}

describe('AccountController', () => {
  it('requests step-up after verifying sender auth and decrypting sender phone', async () => {
    const fixture = controller();

    const result = await fixture.controller.requestStepUp('Bearer access-token', { action: SensitiveAction.EXPORT_DATA });

    expect(result).toEqual({ ok: true, challengeId: 'challenge-1', action: SensitiveAction.EXPORT_DATA, expiresAt: '2026-05-01T10:10:00.000Z' });
    expect(fixture.calls).toContainEqual({
      requestStepUp: {
        userId: 'user-1',
        action: SensitiveAction.EXPORT_DATA,
        phone: '+971501234567',
        language: 'en',
      },
    });
  });

  it('verifies step-up challenges for the authenticated sender', async () => {
    const fixture = controller();

    const result = await fixture.controller.verifyStepUp('Bearer access-token', { challengeId: 'challenge-1', code: '123456' });

    expect(result).toEqual({ ok: true, stepUpToken: 'token-1', action: SensitiveAction.EXPORT_DATA, expiresAt: '2026-05-01T10:10:00.000Z' });
    expect(fixture.calls).toContainEqual({ verifyStepUp: { userId: 'user-1', challengeId: 'challenge-1', code: '123456' } });
  });

  it('requires a step-up token for export and delete', async () => {
    const fixture = controller();

    await expect(fixture.controller.exportAccount('Bearer access-token', undefined)).rejects.toThrow('Step-up verification is required');
    await expect(fixture.controller.deleteAccount('Bearer access-token', undefined, undefined, undefined)).rejects.toThrow(
      'Step-up verification is required',
    );

    await fixture.controller.exportAccount('Bearer access-token', 'token-1');
    await fixture.controller.deleteAccount('Bearer access-token', 'token-2', '127.0.0.1', 'vitest');

    expect(fixture.calls).toContainEqual({ exportAccount: { userId: 'user-1', stepUpToken: 'token-1' } });
    expect(fixture.calls).toContainEqual({
      deleteAccount: { userId: 'user-1', stepUpToken: 'token-2', ipAddress: '127.0.0.1', userAgent: 'vitest' },
    });
  });
});
