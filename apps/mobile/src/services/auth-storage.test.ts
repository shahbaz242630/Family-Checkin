import { describe, expect, it } from 'vitest';
import { createAuthStorage } from './auth-storage';

type TestStorage = {
  values: Map<string, string>;
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

function createTestStorage(): TestStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function createTestLocalStorage(): TestStorage & {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('createAuthStorage', () => {
  it('uses AsyncStorage for native Supabase sessions', async () => {
    const localStorage = createTestLocalStorage();
    const asyncStorage = createTestStorage();
    const secureStore = createTestStorage();

    const storage = createAuthStorage({
      platformOS: 'android',
      hasWindow: true,
      localStorage,
      asyncStorage,
      secureStore,
    });

    await storage.supabaseSessionStorage.setItem('supabase-session', 'large-session-json');

    expect(asyncStorage.values.get('supabase-session')).toBe('large-session-json');
    expect(secureStore.values.has('supabase-session')).toBe(false);
    expect(localStorage.values.has('supabase-session')).toBe(false);
  });

  it('uses SecureStore for native OAuth state', async () => {
    const asyncStorage = createTestStorage();
    const secureStore = createTestStorage();

    const storage = createAuthStorage({
      platformOS: 'android',
      hasWindow: false,
      localStorage: createTestLocalStorage(),
      asyncStorage,
      secureStore,
    });

    await storage.oauthStateStorage.setItem('oauth_state', 'state-token');

    expect(secureStore.values.get('oauth_state')).toBe('state-token');
    expect(asyncStorage.values.has('oauth_state')).toBe(false);
  });

  it('uses localStorage for web Supabase sessions', async () => {
    const localStorage = createTestLocalStorage();
    const asyncStorage = createTestStorage();

    const storage = createAuthStorage({
      platformOS: 'web',
      hasWindow: true,
      localStorage,
      asyncStorage,
      secureStore: createTestStorage(),
    });

    await storage.supabaseSessionStorage.setItem('supabase-session', 'web-session-json');

    expect(localStorage.values.get('supabase-session')).toBe('web-session-json');
    expect(asyncStorage.values.has('supabase-session')).toBe(false);
  });
});
