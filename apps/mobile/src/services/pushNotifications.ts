import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerDeviceToken } from './backendApi';

declare const require: (moduleName: string) => unknown;

type ExpoNotificationsModule = {
  AndroidImportance?: { MAX?: unknown; HIGH?: unknown };
  AndroidNotificationVisibility?: { PUBLIC?: unknown };
  getPermissionsAsync(): Promise<{ status: string }>;
  requestPermissionsAsync(): Promise<{ status: string }>;
  getExpoPushTokenAsync(options?: { projectId?: string }): Promise<{ data: string }>;
  setNotificationChannelAsync?(
    channelId: string,
    channel: {
      name: string;
      importance: unknown;
      sound: string;
      vibrationPattern: number[];
      bypassDnd: boolean;
      enableVibrate: boolean;
      lockscreenVisibility: unknown;
    },
  ): Promise<unknown>;
  setNotificationHandler?(handler: unknown): void;
};

export const EMERGENCY_ALERT_CHANNEL_ID = 'emergency-alerts';
const EMERGENCY_ALERT_SOUND = 'default';
const EMERGENCY_ALERT_VIBRATION_PATTERN = [0, 500, 250, 500, 250, 500];

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

  await ensureEmergencyAlertChannel(notifications);

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

async function ensureEmergencyAlertChannel(notifications: ExpoNotificationsModule): Promise<void> {
  if (Platform.OS !== 'android' || !notifications.setNotificationChannelAsync) {
    return;
  }

  await notifications.setNotificationChannelAsync(EMERGENCY_ALERT_CHANNEL_ID, {
    name: 'Emergency alerts',
    importance: notifications.AndroidImportance?.MAX ?? notifications.AndroidImportance?.HIGH ?? 'max',
    sound: EMERGENCY_ALERT_SOUND,
    vibrationPattern: EMERGENCY_ALERT_VIBRATION_PATTERN,
    bypassDnd: false,
    enableVibrate: true,
    lockscreenVisibility: notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
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
    const runtimeRequire =
      typeof (globalThis as { require?: unknown }).require === 'function'
        ? ((globalThis as { require: (moduleName: string) => unknown }).require)
        : typeof require === 'function'
          ? require
          : null;

    if (!runtimeRequire) {
      return null;
    }

    return runtimeRequire('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
}
