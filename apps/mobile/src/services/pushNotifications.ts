import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerDeviceToken } from './backendApi';

declare const require: (moduleName: string) => unknown;

type ExpoNotificationsModule = {
  getPermissionsAsync(): Promise<{ status: string }>;
  requestPermissionsAsync(): Promise<{ status: string }>;
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<{ data: string }>;
  setNotificationHandler?(handler: unknown): void;
};

let registrationInFlight: Promise<void> | null = null;

export function registerSenderPushNotifications(): Promise<void> {
  if (registrationInFlight) {
    return registrationInFlight;
  }

  registrationInFlight = registerSenderPushNotificationsOnce().finally(() => {
    registrationInFlight = null;
  });

  return registrationInFlight;
}

async function registerSenderPushNotificationsOnce(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  const notifications = loadNotificationsModule();
  if (!notifications) {
    return;
  }

  const permission = await ensurePushPermission(notifications);
  if (!permission) {
    return;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  const token = await notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await registerDeviceToken({
    token: token.data,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    deviceId: Constants.sessionId ?? undefined,
  });
}

async function ensurePushPermission(notifications: ExpoNotificationsModule): Promise<boolean> {
  const existing = await notifications.getPermissionsAsync();
  if (existing.status === 'granted') {
    return true;
  }

  const requested = await notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

function loadNotificationsModule(): ExpoNotificationsModule | null {
  try {
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}
