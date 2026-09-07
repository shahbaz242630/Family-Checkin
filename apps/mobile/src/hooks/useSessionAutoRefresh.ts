// Keeps the Supabase refresh timer in step with the app lifecycle (CB-037).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { startSessionAutoRefresh } from '../services/sessionAutoRefresh';
import { supabase } from '../services/supabase';

/**
 * Call once from the layout that wraps the authenticated app. Mounting it there means the timer runs exactly as
 * long as there is a session to refresh: it stops when the app is backgrounded and again when the sender signs
 * out and the authenticated tree unmounts. The logic itself lives in `services/sessionAutoRefresh.ts`, which is
 * where it is tested.
 */
export function useSessionAutoRefresh(): void {
  useEffect(() => startSessionAutoRefresh({ appState: AppState, auth: supabase.auth }), []);
}
