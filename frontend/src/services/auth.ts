// Authentication service - handles all auth operations via Supabase
import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

export interface AuthError {
  message: string;
  code?: string;
}

export interface AuthResult {
  user: User | null;
  session: Session | null;
  error: AuthError | null;
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'familycheckin://auth/callback',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      return { error: { message: error.message, code: error.code } };
    }

    return { error: null };
  } catch (err) {
    return { error: { message: 'Failed to sign in with Google' } };
  }
}

// Apple Sign In
export async function signInWithApple(): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: 'familycheckin://auth/callback',
      },
    });

    if (error) {
      return { error: { message: error.message, code: error.code } };
    }

    return { error: null };
  } catch (err) {
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
