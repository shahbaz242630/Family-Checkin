import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: string[] = [];

const authSignOut = vi.fn(async () => {
  calls.push('auth');
});
const logOutRevenueCat = vi.fn(async () => {
  calls.push('revenuecat');
});

vi.mock('./auth', () => ({ signOut: () => authSignOut() }));
vi.mock('./revenueCat', () => ({ logOutRevenueCat: () => logOutRevenueCat() }));

const { signOutEverywhere } = await import('./signOutEverywhere');

describe('signOutEverywhere (CB-041)', () => {
  beforeEach(() => {
    calls.length = 0;
    authSignOut.mockClear();
    logOutRevenueCat.mockClear();
    authSignOut.mockImplementation(async () => {
      calls.push('auth');
    });
    logOutRevenueCat.mockImplementation(async () => {
      calls.push('revenuecat');
    });
  });

  it('logs RevenueCat out before Supabase, so the next sender cannot inherit the identity', async () => {
    await signOutEverywhere();

    expect(calls).toEqual(['revenuecat', 'auth']);
  });

  it('still signs the sender out when the store SDK throws', async () => {
    logOutRevenueCat.mockImplementation(async () => {
      calls.push('revenuecat');
      throw new Error('Purchases.logOut failed');
    });

    await expect(signOutEverywhere()).resolves.toBeUndefined();
    expect(calls).toEqual(['revenuecat', 'auth']);
    expect(authSignOut).toHaveBeenCalledTimes(1);
  });

  it('propagates a Supabase sign-out failure, which the caller does surface', async () => {
    authSignOut.mockImplementation(async () => {
      calls.push('auth');
      throw new Error('network');
    });

    await expect(signOutEverywhere()).rejects.toThrow('network');
  });
});
