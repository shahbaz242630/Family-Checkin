/**
 * Supabase's access-token refresh timer against the operating system's app lifecycle (CB-037).
 *
 * `autoRefreshToken: true` starts a timer when the client is created, but a backgrounded React Native app has
 * its timers throttled or frozen: the refresh that was due while the sender was away either never fires or
 * fires late, and the first request after they come back goes out with a token the backend has already
 * expired. Supabase's own guidance for React Native is to drive `startAutoRefresh` / `stopAutoRefresh` from
 * `AppState`, which is what this does — refreshing while the app is in the foreground, idle while it is not.
 *
 * Both collaborators are injected so the behaviour can be tested without React Native or a Supabase client.
 */

/** The part of `supabase.auth` this needs. */
export interface AutoRefreshTarget {
  startAutoRefresh: () => unknown;
  stopAutoRefresh: () => unknown;
}

/** The part of React Native's `AppState` this needs. */
export interface AppStateSource {
  currentState: string | null;
  addEventListener: (type: 'change', handler: (status: string) => void) => { remove: () => void };
}

/**
 * Only `active` refreshes. `background` is obvious; `inactive` is the iOS state during the app switcher, an
 * incoming call or a system prompt, where timers are already unreliable — stopping and restarting is cheap and
 * `startAutoRefresh` refreshes immediately when the app comes back.
 */
export function shouldRefreshInAppState(status: string | null): boolean {
  return status === 'active';
}

/**
 * Applies the current app state and follows it from then on. Returns the unsubscribe function, which also stops
 * the timer — a signed-out app must not keep refreshing a session it no longer has.
 */
export function startSessionAutoRefresh(options: { appState: AppStateSource; auth: AutoRefreshTarget }): () => void {
  const { appState, auth } = options;

  const apply = (status: string | null): void => {
    if (shouldRefreshInAppState(status)) {
      auth.startAutoRefresh();
    } else {
      auth.stopAutoRefresh();
    }
  };

  apply(appState.currentState);
  const subscription = appState.addEventListener('change', apply);

  return () => {
    subscription.remove();
    auth.stopAutoRefresh();
  };
}
