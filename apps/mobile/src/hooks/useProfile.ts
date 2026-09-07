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

/** The two fields the profile form owns. Kept apart from `UserProfile` so the form logic can be tested. */
export interface ProfileFormValues {
  fullName: string;
  phone: string;
}

interface UseProfileReturn {
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>;
}

/** The metadata keys this app owns on a Supabase user; everything else on the record is left untouched. */
type ProfileMetadataKey = 'full_name' | 'avatar_url' | 'phone' | 'timezone' | 'language';
type ProfileMetadata = Partial<Record<ProfileMetadataKey, string>>;

const PROFILE_METADATA_KEYS: ProfileMetadataKey[] = ['full_name', 'avatar_url', 'phone', 'timezone', 'language'];

/**
 * The form values for a loaded profile — the seed for the profile screen. `null` while the profile is still
 * loading, which is what stops the form being seeded with empty strings and then saving them (CB-033).
 */
export function profileFormValues(profile: UserProfile | null): ProfileFormValues | null {
  if (!profile) {
    return null;
  }

  return { fullName: profile.full_name ?? '', phone: profile.phone ?? '' };
}

/** True when the sender has actually typed something different; Save stays disabled until then (CB-033). */
export function profileFormChanged(profile: UserProfile | null, values: ProfileFormValues): boolean {
  const seeded = profileFormValues(profile);
  if (!seeded) {
    return false;
  }

  return seeded.fullName.trim() !== values.fullName.trim() || seeded.phone.trim() !== values.phone.trim();
}

/**
 * The `user_metadata` patch for an update (CB-033). Each key falls back to the value already on the profile, so
 * a partial update never clears a field it did not mention, and a blank value is dropped rather than written:
 * the old form was seeded before the profile loaded, so pressing Save wrote an empty `full_name` over the real
 * name. Blank is not an edit, and Supabase metadata has no "unset" to express one.
 */
export function buildProfileMetadataUpdate(
  profile: UserProfile | null,
  updates: Partial<UserProfile>,
): ProfileMetadata {
  const metadata: ProfileMetadata = {};

  for (const key of PROFILE_METADATA_KEYS) {
    const requested = updates[key];
    const value = (typeof requested === 'string' ? requested.trim() : '') || profile?.[key]?.trim() || '';
    if (value) {
      metadata[key] = value;
    }
  }

  return metadata;
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
        // Sign-up stores the sender's number in `user_metadata.phone`, and that is what the backend reads, so it
        // is what the profile shows and edits. `authUser.phone` is GoTrue's verified phone, which nothing in this
        // app sets yet; it is only the fallback. Moving to a verified number is CB-043 (CB-033).
        phone:
          (typeof authUser.user_metadata?.phone === 'string' ? authUser.user_metadata.phone : null) ??
          authUser.phone ??
          null,
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

      // `data` only: writing the top-level `phone` would start GoTrue's phone-change verification, which this
      // project has no SMS sender for, and would leave the sender with neither the old number nor the new one.
      const { error: updateError } = await supabase.auth.updateUser({
        data: buildProfileMetadataUpdate(profile, updates),
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
