import { beforeEach, describe, expect, it, vi } from 'vitest';

const signUp = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signUp,
    },
  },
}));

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(),
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));

describe('auth service', () => {
  beforeEach(() => {
    signUp.mockReset();
  });

  it('stores sender phone in signup metadata for backend sync', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
      error: null,
    });

    const { signUpWithEmail } = await import('./auth');

    await signUpWithEmail('sender@example.com', 'password123', 'Sender Name', {
      phone: '+971501234567',
      timezone: 'Asia/Dubai',
      country: 'AE',
    });

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'sender@example.com',
        options: expect.objectContaining({
          data: expect.objectContaining({
            phone: '+971501234567',
          }),
        }),
      }),
    );
  });
});
