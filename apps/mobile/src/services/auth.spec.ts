import { beforeEach, describe, expect, it, vi } from 'vitest';

const signUp = vi.fn();
const signInWithOAuth = vi.fn();
const updateUser = vi.fn();
const getRandomBytesAsync = vi.fn();
const makeRedirectUri = vi.fn();
const openAuthSessionAsync = vi.fn();
const handleAuthDeepLink = vi.fn();
const setExpectedOAuthState = vi.fn();
const clearExpectedOAuthState = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signUp,
      signInWithOAuth,
      updateUser,
    },
  },
  handleAuthDeepLink,
  setExpectedOAuthState,
  clearExpectedOAuthState,
}));

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync,
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri,
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync,
}));

describe('auth service', () => {
  beforeEach(() => {
    signUp.mockReset();
    signInWithOAuth.mockReset();
    updateUser.mockReset();
    getRandomBytesAsync.mockReset();
    makeRedirectUri.mockReset();
    openAuthSessionAsync.mockReset();
    handleAuthDeepLink.mockReset();
    setExpectedOAuthState.mockReset();
    clearExpectedOAuthState.mockReset();

    getRandomBytesAsync.mockResolvedValue(new Uint8Array(16).fill(1));
    makeRedirectUri.mockReturnValue('familycheckin://auth/callback');
    setExpectedOAuthState.mockResolvedValue(undefined);
    clearExpectedOAuthState.mockResolvedValue(undefined);
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

  it('stores sender phone after Google OAuth signup completes', async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: 'https://auth.example.test/google' },
      error: null,
    });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'familycheckin://auth/callback#access_token=token',
    });
    handleAuthDeepLink.mockResolvedValue({ success: true });
    updateUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const { signInWithGoogle } = await import('./auth');

    await signInWithGoogle({
      phone: '+971501234567',
      timezone: 'Asia/Dubai',
      country: 'AE',
    });

    expect(updateUser).toHaveBeenCalledWith({
      data: {
        phone: '+971501234567',
        timezone: 'Asia/Dubai',
        country: 'AE',
      },
    });
  });
});
