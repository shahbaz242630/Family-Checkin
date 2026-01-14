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

      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (fetchError) throw fetchError;
      setProfile(data);
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

      const { error: updateError } = await supabase
        .from('users')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user.id);

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
