// useLovedOnes hook - manages loved ones data
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from './useAuth';

export interface LovedOne {
  id: string;
  display_name: string;
  relationship_type: string;
  phone_e164: string | null;
  timezone: string;
  preferred_channels: {
    push: boolean;
    whatsapp: boolean;
    sms: boolean;
    voice: boolean;
    email: boolean;
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined data
  relationship?: {
    id: string;
    relationship_mode: string;
  };
  schedule?: {
    id: string;
    time_local: string;
    days_of_week: number[];
    is_enabled: boolean;
  };
}

interface UseLovedOnesReturn {
  lovedOnes: LovedOne[];
  loading: boolean;
  error: Error | null;
  refreshLovedOnes: () => Promise<void>;
}

export function useLovedOnes(): UseLovedOnesReturn {
  const { user } = useAuth();
  const [lovedOnes, setLovedOnes] = useState<LovedOne[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLovedOnes = useCallback(async () => {
    if (!user?.id) {
      setLovedOnes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch loved ones with their relationships and schedules
      const { data: profiles, error: fetchError } = await supabase
        .from('loved_one_profiles')
        .select(`
          *,
          relationships!inner (
            id,
            relationship_mode,
            checkin_schedules (
              id,
              time_local,
              days_of_week,
              is_enabled
            )
          )
        `)
        .eq('owner_user_id', user.id)
        .eq('is_active', true);

      if (fetchError) throw fetchError;

      // Transform data to include nested relationship and schedule
      const transformed = (profiles || []).map((profile: Record<string, unknown>) => {
        const relationship = (profile.relationships as Record<string, unknown>[])?.[0];
        const schedule = (relationship?.checkin_schedules as Record<string, unknown>[])?.[0];
        return {
          ...profile,
          relationship: relationship ? {
            id: relationship.id as string,
            relationship_mode: relationship.relationship_mode as string,
          } : undefined,
          schedule: schedule ? {
            id: schedule.id as string,
            time_local: schedule.time_local as string,
            days_of_week: schedule.days_of_week as number[],
            is_enabled: schedule.is_enabled as boolean,
          } : undefined,
        };
      });

      setLovedOnes(transformed as LovedOne[]);
    } catch (err) {
      console.error('Error fetching loved ones:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch loved ones'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchLovedOnes();
  }, [fetchLovedOnes]);

  return {
    lovedOnes,
    loading,
    error,
    refreshLovedOnes: fetchLovedOnes,
  };
}
