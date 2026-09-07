import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerDeviceToken } from './backendApi';

type ExpoNotificationPermissions = {
  status: string;
  canAskAgain?: boolean;
  android?: {
    importance?: number;
    /** `NotificationManager.getCurrentInterruptionFilter()` — the live Do Not Disturb mode. */
    interruptionFilter?: number;
  };
  ios?: {
    allowsCriticalAlerts?: boolean | null;
    allowsSound?: boolean | null;
  };
};

type ExpoNotificationChannel = {
  importance?: number;
  bypassDnd?: boolean;
  sound?: 'default' | 'custom' | null;
};

type ExpoNotificationsModule = {
  AndroidImportance?: { MAX?: unknown; HIGH?: unknown };
  AndroidNotificationVisibility?: { PUBLIC?: unknown };
  SchedulableTriggerInputTypes?: { TIME_INTERVAL?: string };
  getPermissionsAsync(): Promise<ExpoNotificationPermissions>;
  requestPermissionsAsync(): Promise<ExpoNotificationPermissions>;
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
  getNotificationChannelAsync?(channelId: string): Promise<ExpoNotificationChannel | null>;
  scheduleNotificationAsync?(request: {
    content: {
      title: string;
      body: string;
      sound: string;
      priority?: string;
      vibrate?: number[];
      interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
      data?: Record<string, unknown>;
    };
    trigger: { type: string; seconds: number; channelId?: string };
  }): Promise<string>;
  setNotificationHandler?(handler: unknown): void;
};

export const EMERGENCY_ALERT_CHANNEL_ID = 'emergency-alerts';
/** Must stay identical to the backend push payload and the `sounds` array in app.json. */
export const EMERGENCY_ALERT_SOUND = 'escalation-siren.wav';
const EMERGENCY_ALERT_VIBRATION_PATTERN = [0, 500, 250, 500, 250, 500];

/** Long enough for the sender to lock the phone before the siren fires (CB-035). */
export const SIREN_TEST_DELAY_SECONDS = 5;
const TIME_INTERVAL_TRIGGER = 'timeInterval';

const SIREN_TEST_WEB_REASON = 'The siren is played by your phone, so this test needs the iOS or Android app.';
const SIREN_TEST_EXPO_GO_REASON =
  'Expo Go cannot play the bundled siren sound. Use a development or store build to test it.';
const SIREN_TEST_MODULE_REASON = 'Notifications are unavailable in this build, so the siren cannot be tested.';
const SIREN_TEST_PERMISSION_REASON =
  'Nearby is not allowed to send notifications. Turn them on in your phone settings, then try again.';

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

  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    return;
  }

  const notifications = await loadNotificationsModule();
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

// --- "Test my siren" (CB-035) ------------------------------------------------

export type PushPermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';
/** Android only. `unknown` on iOS, where the OS does not expose Focus/DND to apps. */
export type DoNotDisturbState = 'off' | 'priority-only' | 'alarms-only' | 'silent' | 'unknown';
/** iOS only. Critical alerts need an Apple entitlement Nearby does not hold yet. */
export type CriticalAlertState = 'allowed' | 'not-allowed' | 'unknown';

export interface SirenTestAvailability {
  available: boolean;
  reason?: string;
}

export interface EmergencyChannelState {
  exists: boolean;
  importance: number | null;
  /** `custom` is the only value that proves the bundled siren is what will play. */
  sound: 'custom' | 'default' | 'silent' | 'unknown';
  bypassesDoNotDisturb: boolean;
}

export interface SirenReadiness {
  availability: SirenTestAvailability;
  permission: PushPermissionState;
  canAskAgain: boolean;
  doNotDisturb: DoNotDisturbState;
  criticalAlerts: CriticalAlertState;
  /** Android only; `null` elsewhere or when the channel could not be read. */
  channel: EmergencyChannelState | null;
}

export type SirenTestOutcome = { scheduled: true; delaySeconds: number } | { scheduled: false; reason: string };

/**
 * Whether a siren test can honestly be run here. Expo Go is excluded because it
 * does not bundle `escalation-siren.wav`: the notification would arrive with the
 * default sound and tell the sender the siren works when nothing was proven.
 */
export function sirenTestAvailability(): SirenTestAvailability {
  if (Platform.OS === 'web') {
    return { available: false, reason: SIREN_TEST_WEB_REASON };
  }

  if (Constants.appOwnership === 'expo') {
    return { available: false, reason: SIREN_TEST_EXPO_GO_REASON };
  }

  return { available: true };
}

export async function readSirenReadiness(): Promise<SirenReadiness> {
  const availability = sirenTestAvailability();
  const unknown: SirenReadiness = {
    availability,
    permission: 'unknown',
    canAskAgain: false,
    doNotDisturb: 'unknown',
    criticalAlerts: 'unknown',
    channel: null,
  };

  if (!availability.available) {
    return unknown;
  }

  const notifications = await loadNotificationsModule();
  if (!notifications) {
    return unknown;
  }

  const permissions = await notifications.getPermissionsAsync();

  return {
    availability,
    permission: toPermissionState(permissions.status),
    canAskAgain: permissions.canAskAgain !== false,
    doNotDisturb: toDoNotDisturbState(permissions.android?.interruptionFilter),
    criticalAlerts: toCriticalAlertState(permissions.ios?.allowsCriticalAlerts),
    channel: await readEmergencyChannel(notifications),
  };
}

/**
 * Schedules the escalation siren as a local notification a few seconds out, so
 * the sender can lock the phone and hear what a real escalation sounds like.
 */
export async function scheduleSirenTest(): Promise<SirenTestOutcome> {
  const availability = sirenTestAvailability();
  if (!availability.available) {
    return { scheduled: false, reason: availability.reason ?? SIREN_TEST_MODULE_REASON };
  }

  const notifications = await loadNotificationsModule();
  if (!notifications?.scheduleNotificationAsync) {
    return { scheduled: false, reason: SIREN_TEST_MODULE_REASON };
  }

  await ensureEmergencyAlertChannel(notifications);

  const granted = await ensurePushPermission(notifications);
  if (!granted) {
    return { scheduled: false, reason: SIREN_TEST_PERMISSION_REASON };
  }

  await notifications.scheduleNotificationAsync({
    content: {
      title: 'Nearby siren test',
      body: 'This is what an escalation alert sounds like. Nobody needs help right now.',
      sound: EMERGENCY_ALERT_SOUND,
      priority: 'max',
      vibrate: EMERGENCY_ALERT_VIBRATION_PATTERN,
      interruptionLevel: 'timeSensitive',
      data: { notificationType: 'siren_test' },
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL ?? TIME_INTERVAL_TRIGGER,
      seconds: SIREN_TEST_DELAY_SECONDS,
      channelId: EMERGENCY_ALERT_CHANNEL_ID,
    },
  });

  return { scheduled: true, delaySeconds: SIREN_TEST_DELAY_SECONDS };
}

function toPermissionState(status: string | undefined): PushPermissionState {
  if (status === 'granted' || status === 'denied' || status === 'undetermined') {
    return status;
  }
  return 'unknown';
}

/** Maps Android's `NotificationManager.INTERRUPTION_FILTER_*` to something readable. */
function toDoNotDisturbState(interruptionFilter: number | undefined): DoNotDisturbState {
  switch (interruptionFilter) {
    case 1:
      return 'off';
    case 2:
      return 'priority-only';
    case 3:
      return 'silent';
    case 4:
      return 'alarms-only';
    default:
      return 'unknown';
  }
}

function toCriticalAlertState(allowsCriticalAlerts: boolean | null | undefined): CriticalAlertState {
  if (allowsCriticalAlerts === true) {
    return 'allowed';
  }
  if (allowsCriticalAlerts === false) {
    return 'not-allowed';
  }
  return 'unknown';
}

async function readEmergencyChannel(notifications: ExpoNotificationsModule): Promise<EmergencyChannelState | null> {
  if (Platform.OS !== 'android' || !notifications.getNotificationChannelAsync) {
    return null;
  }

  const channel = await notifications.getNotificationChannelAsync(EMERGENCY_ALERT_CHANNEL_ID);
  if (!channel) {
    return { exists: false, importance: null, sound: 'unknown', bypassesDoNotDisturb: false };
  }

  return {
    exists: true,
    importance: typeof channel.importance === 'number' ? channel.importance : null,
    sound: channel.sound === 'custom' ? 'custom' : channel.sound === 'default' ? 'default' : 'silent',
    bypassesDoNotDisturb: channel.bypassDnd === true,
  };
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

async function loadNotificationsModule(): Promise<ExpoNotificationsModule | null> {
  try {
    return (await import('expo-notifications')) as ExpoNotificationsModule;
  } catch {
    return null;
  }
}
