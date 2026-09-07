// Receiver dashboard hook - manages receiver summary data.
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from './useAuth';
import { listReceivers, type BackendReceiverSummary } from '../services/backendApi';
import {
  authFailureAction,
  describeBackendError,
  PHONE_REQUIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  type AuthFailureAction,
} from '../services/backendErrors';

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
  /** ISO timestamp while the scheduler cannot evaluate the schedule (CB-069); null when it is fine. */
  schedule_invalid_at: string | null;
  /** ISO timestamp of the last check-in the receiver actually answered; null when they never have (CB-036). */
  last_heard_from: string | null;
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
  /** How the dashboard should render `error`; null while the last load succeeded (CB-032). */
  failure: ReceiversLoadFailure | null;
  refreshReceivers: () => Promise<void>;
}

/**
 * A failed receivers load, in the terms the dashboard needs (CB-032). Until this existed a 401 or a dropped
 * connection was swallowed and the screen said "No receivers yet", which is a lie: it tells a sender their
 * receivers are gone when the app simply could not ask.
 */
export interface ReceiversLoadFailure {
  /** What to show the sender. */
  message: string;
  /**
   * The way out, on top of "Try again": `sign-out` for a dead session, `add-phone` for an account with no
   * usable phone number (CB-037) — that one must never sign the sender out, the session is fine.
   */
  action: AuthFailureAction | null;
}

export const RECEIVERS_LOAD_FAILED_MESSAGE = 'We could not load your receivers. Check your connection and try again.';

export function describeReceiversFailure(error: unknown): ReceiversLoadFailure {
  const action = authFailureAction(error);
  if (action === 'add-phone') {
    return { message: PHONE_REQUIRED_MESSAGE, action };
  }
  if (action === 'sign-out') {
    return { message: SESSION_EXPIRED_MESSAGE, action };
  }

  return { message: describeBackendError(error, RECEIVERS_LOAD_FAILED_MESSAGE), action: null };
}

interface UseLovedOnesReturn {
  lovedOnes: ReceiverDashboardItem[];
  loading: boolean;
  error: Error | null;
  failure: ReceiversLoadFailure | null;
  refreshLovedOnes: () => Promise<void>;
}

/**
 * Receivers for the dashboard. Fetches whenever the screen gains focus (first mount, returning from a detail or
 * the add-receiver form, coming back to the app) so a reply or a removal shows without pull-to-refresh (CB-071).
 * `loading` is true only until the first load completes; focus refetches keep the current list on screen.
 * Must be called from a screen inside a navigator (it relies on `useFocusEffect`).
 */
export function useReceivers(): UseReceiversReturn {
  const { user } = useAuth();
  const [receivers, setReceivers] = useState<ReceiverDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [failure, setFailure] = useState<ReceiversLoadFailure | null>(null);
  const hasLoadedRef = useRef(false);

  const fetchReceivers = useCallback(async () => {
    if (!user?.id) {
      setReceivers([]);
      setLoading(false);
      return;
    }

    try {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setError(null);
      setFailure(null);

      const receiversFromBackend = await listReceivers();
      setReceivers(receiversFromBackend.map(toReceiverDashboardItem));
      hasLoadedRef.current = true;
    } catch (err) {
      console.error('Error fetching receivers:', err);
      // The screen renders `failure`; keeping `error` too so existing callers are unaffected (CB-032).
      setError(err instanceof Error ? err : new Error('Failed to fetch receivers'));
      setFailure(describeReceiversFailure(err));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void fetchReceivers();
    }, [fetchReceivers]),
  );

  return {
    receivers,
    loading,
    error,
    failure,
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
    schedule_invalid_at: receiver.scheduleInvalidAt ?? null,
    last_heard_from: receiver.lastHeardFrom ?? null,
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
  const { receivers, loading, error, failure, refreshReceivers } = useReceivers();

  return {
    lovedOnes: receivers,
    loading,
    error,
    failure,
    refreshLovedOnes: refreshReceivers,
  };
}
