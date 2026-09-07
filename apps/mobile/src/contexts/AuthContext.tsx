// AuthContext - Global authentication state management
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { getAdminMe } from '../services/backendApi';
import { BackendRequestError } from '../services/backendErrors';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True only for a signed-in admin; the drawer gates its admin entries on it (CB-039). */
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * `GET /auth/admin/me` answered once per signed-in user id. A sender who is not an admin is a 403, and
 * caching it is what keeps the app from asking again on every mount (CB-039).
 */
const adminStatusCache = new Map<string, boolean>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
      } catch (error) {
        console.error('Error getting session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setIsLoading(false);

        // Handle specific auth events
        if (event === 'SIGNED_OUT') {
          // Clear any cached data
          setUser(null);
          setSession(null);
        }
      }
    );

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    let cancelled = false;
    void import('../services/pushNotifications')
      .then(({ registerSenderPushNotifications }) => {
        if (!cancelled) {
          return registerSenderPushNotifications();
        }
      })
      .catch((error) => {
        console.warn('Unable to register push notifications:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setIsAdmin(false);
      return;
    }

    const cached = adminStatusCache.get(userId);
    if (cached !== undefined) {
      setIsAdmin(cached);
      return;
    }

    let cancelled = false;
    void getAdminMe()
      .then(() => {
        adminStatusCache.set(userId, true);
        if (!cancelled) {
          setIsAdmin(true);
        }
      })
      .catch((error: unknown) => {
        // 403 is the ordinary answer for a sender; remember it so this user never asks again. A transport
        // failure is not remembered, so an admin who was offline is checked again next time.
        if (error instanceof BackendRequestError && error.status === 403) {
          adminStatusCache.set(userId, false);
        }
        if (!cancelled) {
          setIsAdmin(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!session?.user,
    isAdmin,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
