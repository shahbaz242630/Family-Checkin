// useProfile hook - manages user profile state
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from './useAuth';

export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string;
  language: string;
  created_at: string;
  updated_at: string;
}

interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;
}

export function useProfile(): UseProfileReturn {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase.auth.getUser();
      if (fetchError) throw fetchError;

      const authUser = data.user;
      setProfile({
        id: authUser.id,
        full_name: typeof authUser.user_metadata?.full_name === 'string' ? authUser.user_metadata.full_name : null,
        avatar_url: typeof authUser.user_metadata?.avatar_url === 'string' ? authUser.user_metadata.avatar_url : null,
        phone: authUser.phone ?? null,
        timezone: typeof authUser.user_metadata?.timezone === 'string' ? authUser.user_metadata.timezone : 'Asia/Dubai',
        language: typeof authUser.user_metadata?.language === 'string' ? authUser.user_metadata.language : 'en',
        created_at: authUser.created_at,
        updated_at: authUser.updated_at ?? authUser.created_at,
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch profile'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const updateProfile = async (updates: Partial<UserProfile>): Promise<boolean> => {
    if (!user?.id) return false;

    try {
      setError(null);

      const { error: updateError } = await supabase.auth.updateUser({
        phone: updates.phone ?? undefined,
        data: {
          full_name: updates.full_name ?? profile?.full_name ?? undefined,
          avatar_url: updates.avatar_url ?? profile?.avatar_url ?? undefined,
          timezone: updates.timezone ?? profile?.timezone ?? undefined,
          language: updates.language ?? profile?.language ?? undefined,
        },
      });

      if (updateError) throw updateError;

      // Refresh profile after update
      await fetchProfile();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update profile'));
      return false;
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    refreshProfile: fetchProfile,
    updateProfile,
  };
}
