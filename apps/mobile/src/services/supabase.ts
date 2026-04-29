import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createAuthStorage } from './auth-storage';
import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const { supabaseSessionStorage, oauthStateStorage } = createAuthStorage({
  platformOS: Platform.OS,
  hasWindow: typeof window !== 'undefined',
  localStorage: typeof localStorage === 'undefined' ? undefined : localStorage,
  asyncStorage: AsyncStorage,
  secureStore: {
    getItem: SecureStore.getItemAsync,
    setItem: SecureStore.setItemAsync,
    removeItem: SecureStore.deleteItemAsync,
  },
});

const OAUTH_STATE_KEY = 'oauth_state';

export async function setExpectedOAuthState(state: string): Promise<void> {
  await oauthStateStorage.setItem(OAUTH_STATE_KEY, state);
}

export async function clearExpectedOAuthState(): Promise<void> {
  await oauthStateStorage.removeItem(OAUTH_STATE_KEY);
}

async function consumeExpectedOAuthState(): Promise<string | null> {
  const state = await oauthStateStorage.getItem(OAUTH_STATE_KEY);
  if (state) {
    await oauthStateStorage.removeItem(OAUTH_STATE_KEY);
  }
  return state;
}

function isAllowedAuthRedirect(url: string): boolean {
  const parsed = Linking.parse(url);
  const schemeOk = parsed.scheme === 'familycheckin';
  const path = parsed.path ?? '';
  const pathOk = path === 'auth/callback' || path === 'auth/reset-password';
  return schemeOk && pathOk;
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: supabaseSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    flowType: 'pkce',
    detectSessionInUrl: false,
  },
});

// Deep link URL for auth redirects
export const AUTH_REDIRECT_URL = Linking.createURL('auth/callback');

/**
 * Extract tokens from a deep link URL and create a session
 * Call this when the app receives a deep link from Supabase auth
 */
export const handleAuthDeepLink = async (url: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!isAllowedAuthRedirect(url)) {
      return { success: false, error: 'Invalid authentication link' };
    }

    // Parse the URL to extract tokens
    const parsedUrl = Linking.parse(url);

    // Handle hash fragment (Supabase sends tokens in hash for implicit flow)
    // URL format: familycheckin://auth/callback#access_token=xxx&refresh_token=xxx&...
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    // Check query params first (some flows use this)
    if (parsedUrl.queryParams) {
      accessToken = parsedUrl.queryParams.access_token as string || null;
      refreshToken = parsedUrl.queryParams.refresh_token as string || null;
    }

    // If not in query params, check if tokens are in the path (hash fragment handling)
    if (!accessToken && url.includes('#')) {
      const hashPart = url.split('#')[1];
      if (hashPart) {
        const hashParams = new URLSearchParams(hashPart);
        accessToken = hashParams.get('access_token');
        refreshToken = hashParams.get('refresh_token');
      }
    }

    const stateParam =
      (parsedUrl.queryParams?.state as string | undefined) ||
      (url.includes('#') ? new URLSearchParams(url.split('#')[1] ?? '').get('state') ?? undefined : undefined);

    const expectedState = await consumeExpectedOAuthState();
    if (expectedState) {
      if (!stateParam || expectedState !== stateParam) {
        return { success: false, error: 'Invalid authentication state' };
      }
    }

    const codeParam =
      (parsedUrl.queryParams?.code as string | undefined) ||
      (url.includes('?') ? new URLSearchParams(url.split('?')[1] ?? '').get('code') ?? undefined : undefined);

    if (codeParam) {
      const { error } = await supabase.auth.exchangeCodeForSession(codeParam);
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    }

    if (accessToken && refreshToken) {
      // Set the session with the tokens from the deep link
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        console.error('Error setting session from deep link:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    }

    // Check for error in the URL (e.g., email confirmation failed)
    const error = parsedUrl.queryParams?.error as string;
    const errorDescription = parsedUrl.queryParams?.error_description as string;

    if (error) {
      return { success: false, error: errorDescription || error };
    }

    // No tokens and no error - might be a different type of link
    return { success: false, error: 'No authentication tokens found in URL' };
  } catch (error) {
    console.error('Error handling auth deep link:', error);
    return { success: false, error: 'Failed to process authentication link' };
  }
};

// Helper to get current user
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

// Helper to get current session
export const getSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
};
