// Receiver dashboard hook - manages receiver summary data.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { listReceivers, type BackendReceiverSummary } from '../services/backendApi';

export interface ReceiverDashboardItem {
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

interface UseReceiversReturn {
  receivers: ReceiverDashboardItem[];
  loading: boolean;
  error: Error | null;
  refreshReceivers: () => Promise<void>;
}

interface UseLovedOnesReturn {
  lovedOnes: ReceiverDashboardItem[];
  loading: boolean;
  error: Error | null;
  refreshLovedOnes: () => Promise<void>;
}

export function useReceivers(): UseReceiversReturn {
  const { user } = useAuth();
  const [receivers, setReceivers] = useState<ReceiverDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchReceivers = useCallback(async () => {
    if (!user?.id) {
      setReceivers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const receiversFromBackend = await listReceivers();
      setReceivers(receiversFromBackend.map(toReceiverDashboardItem));
    } catch (err) {
      console.error('Error fetching receivers:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch receivers'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchReceivers();
  }, [fetchReceivers]);

  return {
    receivers,
    loading,
    error,
    refreshReceivers: fetchReceivers,
  };
}

function toReceiverDashboardItem(receiver: BackendReceiverSummary): ReceiverDashboardItem {
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

export type LovedOne = ReceiverDashboardItem;

export function useLovedOnes(): UseLovedOnesReturn {
  const { receivers, loading, error, refreshReceivers } = useReceivers();

  return {
    lovedOnes: receivers,
    loading,
    error,
    refreshLovedOnes: refreshReceivers,
  };
}
