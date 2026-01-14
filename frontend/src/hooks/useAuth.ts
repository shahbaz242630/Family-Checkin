// Auth hook - manages authentication state
import { useState, useEffect, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  signOut as authSignOut,
  resetPassword,
  getCurrentSession,
  onAuthStateChange,
  type AuthError,
} from '../services/auth';

interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: AuthError | null;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string, fullName: string) => Promise<boolean>;
  signInGoogle: () => Promise<boolean>;
  signInApple: () => Promise<boolean>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<boolean>;
  clearError: () => void;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const currentSession = await getCurrentSession();
        if (mounted) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = onAuthStateChange((event, newSession) => {
      if (mounted) {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (event === 'SIGNED_OUT') {
          setError(null);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    const result = await signInWithEmail(email, password);

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);

    const result = await signUpWithEmail(email, password, fullName);

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  }, []);

  const signInGoogle = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    const result = await signInWithGoogle();

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  }, []);

  const signInApple = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    const result = await signInWithApple();

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    setLoading(true);
    await authSignOut();
    setLoading(false);
  }, []);

  const forgotPassword = useCallback(async (email: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    const result = await resetPassword(email);

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return false;
    }

    return true;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    user,
    session,
    loading,
    error,
    isAuthenticated: !!session,
    signIn,
    signUp,
    signInGoogle,
    signInApple,
    signOut,
    forgotPassword,
    clearError,
  };
}
