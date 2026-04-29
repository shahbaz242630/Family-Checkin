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

async function expectEqual(actual: unknown, expected: unknown, message: string): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function testNativeSupabaseSessionUsesAsyncStorage(): Promise<void> {
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

  await expectEqual(asyncStorage.values.get('supabase-session'), 'large-session-json', 'native session should use AsyncStorage');
  await expectEqual(secureStore.values.has('supabase-session'), false, 'native session should not use SecureStore');
  await expectEqual(localStorage.values.has('supabase-session'), false, 'native session should not use localStorage');
}

async function testNativeOAuthStateUsesSecureStore(): Promise<void> {
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

  await expectEqual(secureStore.values.get('oauth_state'), 'state-token', 'OAuth state should use SecureStore');
  await expectEqual(asyncStorage.values.has('oauth_state'), false, 'OAuth state should not use AsyncStorage');
}

async function testWebSupabaseSessionUsesLocalStorage(): Promise<void> {
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

  await expectEqual(localStorage.values.get('supabase-session'), 'web-session-json', 'web session should use localStorage');
  await expectEqual(asyncStorage.values.has('supabase-session'), false, 'web session should not use AsyncStorage');
}

async function main(): Promise<void> {
  await testNativeSupabaseSessionUsesAsyncStorage();
  await testNativeOAuthStateUsesSecureStore();
  await testWebSupabaseSessionUsesLocalStorage();
}

void main();
