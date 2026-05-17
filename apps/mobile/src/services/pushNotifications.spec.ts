import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPermissionsAsync = vi.fn();
const requestPermissionsAsync = vi.fn();
const getExpoPushTokenAsync = vi.fn();
const setNotificationChannelAsync = vi.fn();
const registerDeviceToken = vi.fn();

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    easConfig: undefined,
    sessionId: 'device-1',
  },
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: {
    MAX: 'max',
  },
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  setNotificationChannelAsync,
}));

vi.mock('./backendApi', () => ({
  registerDeviceToken,
}));

describe('push notification registration', () => {
  beforeEach(() => {
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[abc123]' });
    setNotificationChannelAsync.mockResolvedValue(null);
    registerDeviceToken.mockResolvedValue({ id: 'device-token-1' });
    vi.stubGlobal('require', (moduleName: string) => {
      if (moduleName !== 'expo-notifications') {
        throw new Error(`Unexpected module: ${moduleName}`);
      }

      return {
        AndroidImportance: { MAX: 'max' },
        getPermissionsAsync,
        requestPermissionsAsync,
        getExpoPushTokenAsync,
        setNotificationChannelAsync,
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('creates the Android emergency alert channel before registering the token', async () => {
    const { registerSenderPushNotifications } = await import('./pushNotifications');

    await registerSenderPushNotifications();

    expect(setNotificationChannelAsync).toHaveBeenCalledWith('emergency-alerts', {
      name: 'Emergency alerts',
      importance: 'max',
      sound: 'default',
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      bypassDnd: false,
      enableVibrate: true,
      lockscreenVisibility: 1,
    });
    expect(registerDeviceToken).toHaveBeenCalledWith({
      token: 'ExpoPushToken[abc123]',
      platform: 'android',
      deviceId: 'device-1',
    });
  });
});
