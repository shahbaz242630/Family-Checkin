// useLovedOnes hook - manages loved ones data
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { listReceivers, type BackendReceiverSummary } from '../services';

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
  consent_status: string;
  paused_reason?: string;
  paused_until?: string;
  latest_check_in_status?: string;
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

      const receivers = await listReceivers();
      setLovedOnes(receivers.map(toLovedOne));
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

function toLovedOne(receiver: BackendReceiverSummary): LovedOne {
  return {
    id: receiver.id,
    display_name: receiver.displayName,
    relationship_type: receiver.relationshipType,
    phone_e164: receiver.phoneMasked,
    timezone: receiver.timezone,
    preferred_channels: {
      push: false,
      whatsapp: receiver.primaryChannel === 'WHATSAPP' || receiver.fallbackChannels.includes('WHATSAPP'),
      sms: receiver.primaryChannel === 'SMS' || receiver.fallbackChannels.includes('SMS'),
      voice: receiver.primaryChannel === 'VOICE' || receiver.fallbackChannels.includes('VOICE'),
      email: false,
    },
    is_active: receiver.consentStatus === 'GRANTED' && !receiver.pausedReason,
    consent_status: receiver.consentStatus,
    paused_reason: receiver.pausedReason,
    paused_until: receiver.pausedUntil,
    latest_check_in_status: receiver.latestCheckIn?.status,
    created_at: receiver.createdAt,
    updated_at: receiver.updatedAt,
    relationship: {
      id: receiver.id,
      relationship_mode: receiver.relationshipType,
    },
    schedule: {
      id: receiver.id,
      time_local: receiver.scheduleTimeWindow.start ?? '09:00',
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      is_enabled: receiver.consentStatus === 'GRANTED',
    },
  };
}
