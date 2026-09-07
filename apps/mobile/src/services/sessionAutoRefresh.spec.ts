import { describe, expect, it, vi } from 'vitest';
import { shouldRefreshInAppState, startSessionAutoRefresh } from './sessionAutoRefresh';

function fakeAppState(currentState: string) {
  let handlers: ((status: string) => void)[] = [];
  // Removal really removes, the way React Native's subscription does, so the unmount test means something.
  const remove = vi.fn(() => {
    handlers = [];
  });

  return {
    currentState,
    addEventListener: vi.fn((_type: 'change', handler: (status: string) => void) => {
      handlers.push(handler);
      return { remove };
    }),
    emit(status: string) {
      for (const handler of [...handlers]) {
        handler(status);
      }
    },
    remove,
  };
}

function fakeAuth() {
  return { startAutoRefresh: vi.fn(), stopAutoRefresh: vi.fn() };
}

describe('session auto refresh follows the app lifecycle (CB-037)', () => {
  it('refreshes only while the app is in the foreground', () => {
    expect(shouldRefreshInAppState('active')).toBe(true);
    // `inactive` is the iOS app switcher / incoming call, where timers are already unreliable.
    expect(shouldRefreshInAppState('inactive')).toBe(false);
    expect(shouldRefreshInAppState('background')).toBe(false);
    expect(shouldRefreshInAppState(null)).toBe(false);
  });

  it('starts refreshing at once when the app is already active', () => {
    const appState = fakeAppState('active');
    const auth = fakeAuth();

    startSessionAutoRefresh({ appState, auth });

    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.stopAutoRefresh).not.toHaveBeenCalled();
  });

  it('stops the timer when the app goes to the background and starts it again on return', () => {
    const appState = fakeAppState('active');
    const auth = fakeAuth();
    startSessionAutoRefresh({ appState, auth });
    auth.startAutoRefresh.mockClear();

    appState.emit('background');
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();

    // Supabase refreshes immediately on start, so a token that expired while away is replaced before the first
    // request goes out (CB-037).
    appState.emit('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a session it was mounted without', () => {
    const appState = fakeAppState('background');
    const auth = fakeAuth();

    startSessionAutoRefresh({ appState, auth });

    expect(auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and stops the timer when the authenticated tree unmounts', () => {
    const appState = fakeAppState('active');
    const auth = fakeAuth();

    const stop = startSessionAutoRefresh({ appState, auth });
    stop();

    expect(appState.remove).toHaveBeenCalledTimes(1);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);

    // A removed listener must not keep driving the client after sign-out.
    appState.emit('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });
});
