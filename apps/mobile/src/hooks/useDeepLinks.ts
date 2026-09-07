// The app's single deep-link handler (CB-029).
//
// Before this hook, the root layout AND the landing screen each read the incoming URL and each called
// `handleAuthDeepLink`. The second call always failed — the PKCE code had already been exchanged and the
// OAuth state already consumed — so a confirmation that had just succeeded flashed "Verification Failed"
// and bounced the sender back to login. A warm-start recovery link failed for the mirror-image reason:
// `Linking.getInitialURL()` returns the URL the app was *launched* with, not the one that just arrived.
//
// Now the root layout mounts `useDeepLinks` and it is the only place that reads a URL and the only place
// that calls `handleAuthDeepLink`. The auth screens are told the outcome through route params, so the same
// link is never processed twice and a warm start is handled exactly like a cold one.
//
// The logic lives in plain functions (`classifyAuthDeepLink`, `resolveAuthDeepLink`,
// `createAuthDeepLinkHandler`) so it is covered by `useDeepLinks.spec.ts` without rendering a screen.
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { handleAuthDeepLink } from '../services/supabase';

/**
 * How long an auth screen waits for this handler to report an outcome before it decides no deep link is
 * coming (direct navigation, or a link that never resolved). Long enough to cover the token exchange.
 */
export const DEEP_LINK_SETTLE_MS = 5000;

/** What the incoming URL is for. `null` means "not an auth link" — this handler ignores it. */
export type AuthDeepLinkKind = 'callback' | 'reset-password';

/** Where the handler sends the app once the link has been processed, and what the screen is told. */
export interface AuthDeepLinkTarget {
  pathname: '/auth/callback' | '/auth/reset-password';
  params: { status: 'success' | 'ready' | 'error'; message?: string };
}

/** The `handleAuthDeepLink` contract, injected so the handler can be tested without Supabase. */
export type ProcessAuthDeepLink = (url: string) => Promise<{ success: boolean; error?: string }>;

const CALLBACK_FALLBACK_ERROR = 'Authentication failed';
const RESET_FALLBACK_ERROR = 'Invalid or expired reset link';
const PROCESSING_FAILED_ERROR = 'Failed to process authentication link';

/**
 * Which auth screen a URL belongs to. Recovery links are checked first: a Supabase recovery redirect can
 * carry `type=recovery` on a `auth/callback` path, and it must still land on the password form.
 */
export function classifyAuthDeepLink(url: string): AuthDeepLinkKind | null {
  if (url.includes('reset-password') || url.includes('type=recovery')) {
    return 'reset-password';
  }

  if (url.includes('auth/callback') || url.includes('access_token')) {
    return 'callback';
  }

  return null;
}

/**
 * Process one auth deep link and say where the app should go. Returns `null` for a URL that is not an auth
 * link, so ordinary deep links are left to Expo Router.
 */
export async function resolveAuthDeepLink(
  url: string,
  processLink: ProcessAuthDeepLink,
): Promise<AuthDeepLinkTarget | null> {
  const kind = classifyAuthDeepLink(url);
  if (!kind) {
    return null;
  }

  let result: { success: boolean; error?: string };
  try {
    result = await processLink(url);
  } catch {
    result = { success: false, error: PROCESSING_FAILED_ERROR };
  }

  if (kind === 'reset-password') {
    return result.success
      ? { pathname: '/auth/reset-password', params: { status: 'ready' } }
      : {
          pathname: '/auth/reset-password',
          params: { status: 'error', message: result.error || RESET_FALLBACK_ERROR },
        };
  }

  return result.success
    ? { pathname: '/auth/callback', params: { status: 'success' } }
    : {
        pathname: '/auth/callback',
        params: { status: 'error', message: result.error || CALLBACK_FALLBACK_ERROR },
      };
}

/**
 * One handler for every URL the app is given, cold start and warm start alike. A URL is processed at most
 * once: Android can deliver the launch intent through both `getInitialURL()` and the `url` event, and a
 * second `handleAuthDeepLink` on an already-exchanged code is exactly the failure CB-029 is about.
 */
export function createAuthDeepLinkHandler(deps: {
  processLink: ProcessAuthDeepLink;
  navigate: (target: AuthDeepLinkTarget) => void;
}): (url: string | null | undefined) => Promise<void> {
  const handled = new Set<string>();

  return async (url) => {
    if (!url || handled.has(url) || !classifyAuthDeepLink(url)) {
      return;
    }

    handled.add(url);

    const target = await resolveAuthDeepLink(url, deps.processLink);
    if (target) {
      deps.navigate(target);
    }
  };
}

/** Mounted once, by the root layout. Nothing else may subscribe to auth deep links. */
export function useDeepLinks(): void {
  const router = useRouter();

  useEffect(() => {
    const handle = createAuthDeepLinkHandler({
      processLink: handleAuthDeepLink,
      navigate: (target) => {
        router.replace(target as never);
      },
    });

    // Cold start: the URL the app was launched with.
    void Linking.getInitialURL().then((url) => handle(url));

    // Warm start: every URL delivered while the app is running.
    const subscription = Linking.addEventListener('url', (event) => {
      void handle(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [router]);
}
