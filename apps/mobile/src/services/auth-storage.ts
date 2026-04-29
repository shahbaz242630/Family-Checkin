type PlatformOS = 'ios' | 'android' | 'web' | string;

export type StorageAdapter = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

type LocalStorageAdapter = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type AuthStorageOptions = {
  platformOS: PlatformOS;
  hasWindow: boolean;
  localStorage?: LocalStorageAdapter;
  asyncStorage: StorageAdapter;
  secureStore: StorageAdapter;
};

export function createAuthStorage(options: AuthStorageOptions): {
  supabaseSessionStorage: StorageAdapter;
  oauthStateStorage: StorageAdapter;
} {
  const webStorage = options.hasWindow ? createWebStorage(options.localStorage) : createWebStorage(undefined);

  return {
    supabaseSessionStorage: createSupabaseSessionStorage(options, webStorage),
    oauthStateStorage: options.platformOS === 'web' ? webStorage : options.secureStore,
  };
}

function createSupabaseSessionStorage(options: AuthStorageOptions, webStorage: StorageAdapter): StorageAdapter {
  if (options.platformOS === 'web') {
    return webStorage;
  }

  return options.asyncStorage;
}

function createWebStorage(localStorage: LocalStorageAdapter | undefined): StorageAdapter {
  return {
    getItem(key: string) {
      return localStorage?.getItem(key) ?? null;
    },
    setItem(key: string, value: string) {
      localStorage?.setItem(key, value);
    },
    removeItem(key: string) {
      localStorage?.removeItem(key);
    },
  };
}
