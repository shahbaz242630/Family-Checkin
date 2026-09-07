import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyAuthDeepLink,
  createAuthDeepLinkHandler,
  resolveAuthDeepLink,
  DEEP_LINK_SETTLE_MS,
  type AuthDeepLinkTarget,
  type ProcessAuthDeepLink,
} from './useDeepLinks';

// `useDeepLinks.ts` pulls in the Supabase client and Expo's native modules only for the hook itself; the
// deep-link logic under test is plain functions, so the modules are stubbed to keep the import graph clean.
// (`vi.mock` is hoisted above these imports.)
vi.mock('../services/supabase', () => ({
  handleAuthDeepLink: vi.fn(),
}));

vi.mock('expo-linking', () => ({
  getInitialURL: vi.fn(),
  addEventListener: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: vi.fn(),
}));

const CALLBACK_LINK = 'familycheckin://auth/callback?code=exchange-code';
const RESET_LINK = 'familycheckin://auth/reset-password?code=recovery-code';

describe('classifyAuthDeepLink', () => {
  it('routes a recovery link to the password form', () => {
    expect(classifyAuthDeepLink(RESET_LINK)).toBe('reset-password');
  });

  it('routes a callback link carrying type=recovery to the password form, not the callback screen', () => {
    expect(classifyAuthDeepLink('familycheckin://auth/callback?type=recovery&code=abc')).toBe('reset-password');
  });

  it('routes an email confirmation to the callback screen', () => {
    expect(classifyAuthDeepLink(CALLBACK_LINK)).toBe('callback');
  });

  it('routes an implicit-flow link carrying tokens in the fragment to the callback screen', () => {
    expect(classifyAuthDeepLink('familycheckin://auth/callback#access_token=a&refresh_token=b')).toBe('callback');
  });

  it('ignores a link that is not an auth link', () => {
    expect(classifyAuthDeepLink('familycheckin://receivers/abc-123')).toBeNull();
    expect(classifyAuthDeepLink('http://localhost:8081/')).toBeNull();
  });
});

describe('resolveAuthDeepLink', () => {
  it('sends a confirmed email to the callback screen with a success status', async () => {
    const processLink = vi.fn().mockResolvedValue({ success: true });

    await expect(resolveAuthDeepLink(CALLBACK_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/callback',
      params: { status: 'success' },
    });
    expect(processLink).toHaveBeenCalledWith(CALLBACK_LINK);
  });

  it('carries the failure reason to the callback screen', async () => {
    const processLink = vi.fn().mockResolvedValue({ success: false, error: 'Email link is invalid or has expired' });

    await expect(resolveAuthDeepLink(CALLBACK_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/callback',
      params: { status: 'error', message: 'Email link is invalid or has expired' },
    });
  });

  it('falls back to a readable message when the failure carries none', async () => {
    const processLink = vi.fn().mockResolvedValue({ success: false });

    await expect(resolveAuthDeepLink(CALLBACK_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/callback',
      params: { status: 'error', message: 'Authentication failed' },
    });
  });

  it('sends a valid recovery link to the password form ready to accept a new password', async () => {
    const processLink = vi.fn().mockResolvedValue({ success: true });

    await expect(resolveAuthDeepLink(RESET_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/reset-password',
      params: { status: 'ready' },
    });
  });

  it('carries the failure reason to the password form', async () => {
    const processLink = vi.fn().mockResolvedValue({ success: false, error: 'Token has expired' });

    await expect(resolveAuthDeepLink(RESET_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/reset-password',
      params: { status: 'error', message: 'Token has expired' },
    });
  });

  it('treats a thrown processor as a failure rather than losing the navigation', async () => {
    const processLink = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(resolveAuthDeepLink(CALLBACK_LINK, processLink)).resolves.toEqual({
      pathname: '/auth/callback',
      params: { status: 'error', message: 'Failed to process authentication link' },
    });
  });

  it('leaves a non-auth link alone and never touches the session', async () => {
    const processLink = vi.fn();

    await expect(resolveAuthDeepLink('familycheckin://receivers/abc-123', processLink)).resolves.toBeNull();
    expect(processLink).not.toHaveBeenCalled();
  });
});

describe('createAuthDeepLinkHandler', () => {
  const processLink = vi.fn<ProcessAuthDeepLink>();
  const navigate = vi.fn<(target: AuthDeepLinkTarget) => void>();
  let handle: (url: string | null | undefined) => Promise<void>;

  beforeEach(() => {
    processLink.mockReset();
    processLink.mockResolvedValue({ success: true });
    navigate.mockReset();
    handle = createAuthDeepLinkHandler({ processLink, navigate });
  });

  it('processes an email confirmation once and navigates with the result', async () => {
    await handle(CALLBACK_LINK);

    expect(processLink).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith<[AuthDeepLinkTarget]>({
      pathname: '/auth/callback',
      params: { status: 'success' },
    });
  });

  it('processes the same URL once when it arrives through both the launch intent and the url event', async () => {
    await handle(CALLBACK_LINK);
    await handle(CALLBACK_LINK);

    // The second exchange would fail on an already-consumed code and overwrite the success with
    // "Verification Failed" — the CB-029 defect.
    expect(processLink).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still processes a second, different recovery link', async () => {
    await handle(RESET_LINK);
    await handle('familycheckin://auth/reset-password?code=another-code');

    expect(processLink).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenNthCalledWith(2, {
      pathname: '/auth/reset-password',
      params: { status: 'ready' },
    });
  });

  it('does nothing when there is no launch URL', async () => {
    await handle(null);
    await handle(undefined);
    await handle('');

    expect(processLink).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores a non-auth deep link without navigating', async () => {
    await handle('familycheckin://receivers/abc-123');

    expect(processLink).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a failed exchange to the callback screen instead of dropping the sender on the dashboard', async () => {
    processLink.mockResolvedValue({ success: false, error: 'Invalid authentication link' });

    await handle(CALLBACK_LINK);

    expect(navigate).toHaveBeenCalledWith({
      pathname: '/auth/callback',
      params: { status: 'error', message: 'Invalid authentication link' },
    });
  });
});

describe('DEEP_LINK_SETTLE_MS', () => {
  it('gives the token exchange room before a screen gives up on it', () => {
    expect(DEEP_LINK_SETTLE_MS).toBeGreaterThanOrEqual(3000);
  });
});
