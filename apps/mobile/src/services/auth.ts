// Authentication service - handles all auth operations via Supabase
import { supabase, handleAuthDeepLink, setExpectedOAuthState, clearExpectedOAuthState } from './supabase';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import type { User, Session } from '@supabase/supabase-js';

// Warm up the browser for faster OAuth
WebBrowser.maybeCompleteAuthSession();

export interface AuthError {
  message: string;
  code?: string;
}

export interface AuthResult {
  user: User | null;
  session: Session | null;
  error: AuthError | null;
}

async function generateOAuthState(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Email/Password Sign Up
export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
  metadata?: { timezone?: string; country?: string }
): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'familycheckin://auth/callback',
        data: {
          full_name: fullName,
          timezone: metadata?.timezone || 'Asia/Dubai',
          country: metadata?.country || 'AE',
        },
      },
    });

    if (error) {
      return { user: null, session: null, error: { message: error.message, code: error.code } };
    }

    return { user: data.user, session: data.session, error: null };
  } catch (err) {
    return { user: null, session: null, error: { message: 'An unexpected error occurred' } };
  }
}

// Email/Password Sign In
export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { user: null, session: null, error: { message: error.message, code: error.code } };
    }

    return { user: data.user, session: data.session, error: null };
  } catch (err) {
    return { user: null, session: null, error: { message: 'An unexpected error occurred' } };
  }
}

// Google Sign In
export async function signInWithGoogle(): Promise<{ error: AuthError | null }> {
  try {
    // Create redirect URI that works for both Expo Go and standalone builds
    const redirectTo = makeRedirectUri({
      scheme: 'familycheckin',
      path: 'auth/callback',
    });

    console.log('Google OAuth redirect URL:', redirectTo);
    const state = await generateOAuthState();
    await setExpectedOAuthState(state);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
          state,
        },
      },
    });

    if (error) {
      await clearExpectedOAuthState();
      return { error: { message: error.message, code: error.code } };
    }

    if (data?.url) {
      // Open the OAuth URL in the browser
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo
      );

      if (result.type === 'success' && result.url) {
        const handleResult = await handleAuthDeepLink(result.url);
        if (!handleResult.success) {
          return { error: { message: handleResult.error || 'Authentication failed' } };
        }
      } else if (result.type === 'cancel') {
        await clearExpectedOAuthState();
        return { error: { message: 'Sign in was cancelled' } };
      }
    }

    return { error: null };
  } catch (err) {
    await clearExpectedOAuthState();
    console.error('Google sign in error:', err);
    return { error: { message: 'Failed to sign in with Google' } };
  }
}

// Apple Sign In
export async function signInWithApple(): Promise<{ error: AuthError | null }> {
  try {
    const redirectTo = makeRedirectUri({
      scheme: 'familycheckin',
      path: 'auth/callback',
    });

    const state = await generateOAuthState();
    await setExpectedOAuthState(state);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { state },
      },
    });

    if (error) {
      await clearExpectedOAuthState();
      return { error: { message: error.message, code: error.code } };
    }

    if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success' && result.url) {
        const handleResult = await handleAuthDeepLink(result.url);
        if (!handleResult.success) {
          return { error: { message: handleResult.error || 'Authentication failed' } };
        }
      } else if (result.type === 'cancel') {
        await clearExpectedOAuthState();
        return { error: { message: 'Sign in was cancelled' } };
      }
    }

    return { error: null };
  } catch (err) {
    await clearExpectedOAuthState();
    return { error: { message: 'Failed to sign in with Apple' } };
  }
}

// Password Reset
export async function resetPassword(email: string): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'familycheckin://auth/reset-password',
    });

    if (error) {
      return { error: { message: error.message, code: error.code } };
    }

    return { error: null };
  } catch (err) {
    return { error: { message: 'Failed to send reset email' } };
  }
}

// Update Password (after reset)
export async function updatePassword(newPassword: string): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { error: { message: error.message, code: error.code } };
    }

    return { error: null };
  } catch (err) {
    return { error: { message: 'Failed to update password' } };
  }
}

// Sign Out
export async function signOut(): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { error: { message: error.message, code: error.code } };
    }

    return { error: null };
  } catch (err) {
    return { error: { message: 'Failed to sign out' } };
  }
}

// Get Current Session
export async function getCurrentSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// Get Current User
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Listen to auth state changes
export function onAuthStateChange(
  callback: (event: string, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
