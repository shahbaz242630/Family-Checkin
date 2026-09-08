import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' as string },
  constants: {
    expoConfig: { extra: { eas: { projectId: 'project-1' } } } as unknown,
    easConfig: undefined as unknown,
    appOwnership: 'standalone' as string | null,
    sessionId: 'device-1' as string | undefined,
  },
}));

const getPermissionsAsync = vi.fn();
const requestPermissionsAsync = vi.fn();
const getExpoPushTokenAsync = vi.fn();
const setNotificationChannelAsync = vi.fn();
const getNotificationChannelAsync = vi.fn();
const scheduleNotificationAsync = vi.fn();
const registerDeviceToken = vi.fn();

vi.mock('react-native', () => ({
  Platform: mocks.platform,
}));

vi.mock('expo-constants', () => ({
  default: mocks.constants,
}));

vi.mock('expo-notifications', () => ({
  AndroidImportance: {
    MAX: 'max',
  },
  AndroidNotificationVisibility: {
    PUBLIC: 1,
  },
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 'timeInterval',
  },
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  setNotificationChannelAsync,
  getNotificationChannelAsync,
  scheduleNotificationAsync,
}));

vi.mock('./backendApi', () => ({
  registerDeviceToken,
}));

describe('push notification registration', () => {
  beforeEach(() => {
    mocks.platform.OS = 'android';
    mocks.constants.appOwnership = 'standalone';
    getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[abc123]' });
    setNotificationChannelAsync.mockResolvedValue(null);
    getNotificationChannelAsync.mockResolvedValue(null);
    scheduleNotificationAsync.mockResolvedValue('scheduled-1');
    registerDeviceToken.mockResolvedValue({ id: 'device-token-1' });
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
      sound: 'escalation_siren.wav',
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      // Requested, not guaranteed: Android grants it only if the user has given
      // Nearby Do Not Disturb access, and silently ignores it otherwise. The
      // security screen reads the channel back and says which way it went.
      bypassDnd: true,
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

describe('siren test (CB-035)', () => {
  beforeEach(() => {
    mocks.platform.OS = 'android';
    mocks.constants.appOwnership = 'standalone';
    getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    requestPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    setNotificationChannelAsync.mockResolvedValue(null);
    getNotificationChannelAsync.mockResolvedValue(null);
    scheduleNotificationAsync.mockResolvedValue('scheduled-1');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('schedules a local notification on the emergency channel with the siren sound', async () => {
    const { scheduleSirenTest, SIREN_TEST_DELAY_SECONDS } = await import('./pushNotifications');

    const outcome = await scheduleSirenTest();

    expect(outcome).toEqual({ scheduled: true, delaySeconds: SIREN_TEST_DELAY_SECONDS });
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    const request = scheduleNotificationAsync.mock.calls[0][0];
    expect(request.content.sound).toBe('escalation_siren.wav');
    expect(request.content.interruptionLevel).toBe('timeSensitive');
    expect(request.content.priority).toBe('max');
    expect(request.content.vibrate).toEqual([0, 500, 250, 500, 250, 500]);
    expect(request.content.data).toEqual({ notificationType: 'siren_test' });
    expect(request.trigger).toEqual({
      type: 'timeInterval',
      seconds: SIREN_TEST_DELAY_SECONDS,
      channelId: 'emergency-alerts',
    });
  });

  it('leaves a delay so the sender can background the app before the siren fires', async () => {
    const { SIREN_TEST_DELAY_SECONDS } = await import('./pushNotifications');

    expect(SIREN_TEST_DELAY_SECONDS).toBeGreaterThanOrEqual(3);
  });

  it('recreates the emergency channel before scheduling so the sound is in place', async () => {
    const { scheduleSirenTest } = await import('./pushNotifications');

    await scheduleSirenTest();

    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'emergency-alerts',
      expect.objectContaining({ sound: 'escalation_siren.wav' }),
    );
    expect(setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleNotificationAsync.mock.invocationCallOrder[0],
    );
  });

  it('asks for notification permission when it has not been granted yet', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    const { scheduleSirenTest } = await import('./pushNotifications');

    const outcome = await scheduleSirenTest();

    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(outcome.scheduled).toBe(true);
  });

  it('refuses without scheduling anything when notifications are denied', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    requestPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const { scheduleSirenTest } = await import('./pushNotifications');

    const outcome = await scheduleSirenTest();

    expect(outcome.scheduled).toBe(false);
    expect(outcome.scheduled === false && outcome.reason).toContain('not allowed to send notifications');
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('refuses in Expo Go, which does not bundle the siren sound', async () => {
    mocks.constants.appOwnership = 'expo';
    const { scheduleSirenTest, sirenTestAvailability } = await import('./pushNotifications');

    expect(sirenTestAvailability().available).toBe(false);
    const outcome = await scheduleSirenTest();

    expect(outcome.scheduled).toBe(false);
    expect(outcome.scheduled === false && outcome.reason).toContain('Expo Go');
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('refuses on web, where the phone is not the delivery device', async () => {
    mocks.platform.OS = 'web';
    const { scheduleSirenTest } = await import('./pushNotifications');

    const outcome = await scheduleSirenTest();

    expect(outcome.scheduled).toBe(false);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('siren readiness (CB-035)', () => {
  beforeEach(() => {
    mocks.platform.OS = 'android';
    mocks.constants.appOwnership = 'standalone';
    getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    getNotificationChannelAsync.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reports permission, Do Not Disturb and the emergency channel on Android', async () => {
    getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
      android: { importance: 7, interruptionFilter: 2 },
    });
    getNotificationChannelAsync.mockResolvedValue({
      importance: 7,
      bypassDnd: false,
      sound: 'custom',
    });
    const { readSirenReadiness } = await import('./pushNotifications');

    const readiness = await readSirenReadiness();

    expect(getNotificationChannelAsync).toHaveBeenCalledWith('emergency-alerts');
    expect(readiness).toEqual({
      availability: { available: true },
      permission: 'granted',
      canAskAgain: true,
      doNotDisturb: 'priority-only',
      criticalAlerts: 'unknown',
      channel: { exists: true, importance: 7, sound: 'custom', bypassesDoNotDisturb: false },
    });
  });

  it('maps every Android interruption filter to a readable Do Not Disturb state', async () => {
    const { readSirenReadiness } = await import('./pushNotifications');

    const cases: [number | undefined, string][] = [
      [1, 'off'],
      [2, 'priority-only'],
      [3, 'silent'],
      [4, 'alarms-only'],
      [0, 'unknown'],
      [undefined, 'unknown'],
    ];

    for (const [interruptionFilter, expected] of cases) {
      getPermissionsAsync.mockResolvedValue({
        status: 'granted',
        canAskAgain: true,
        android: { interruptionFilter },
      });

      await expect(readSirenReadiness().then((r) => r.doNotDisturb)).resolves.toBe(expected);
    }
  });

  it('reports a missing Android channel rather than pretending it is configured', async () => {
    getNotificationChannelAsync.mockResolvedValue(null);
    const { readSirenReadiness } = await import('./pushNotifications');

    const readiness = await readSirenReadiness();

    expect(readiness.channel).toEqual({
      exists: false,
      importance: null,
      sound: 'unknown',
      bypassesDoNotDisturb: false,
    });
  });

  it('reports the iOS critical-alert entitlement and no Android channel', async () => {
    mocks.platform.OS = 'ios';
    getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
      ios: { allowsCriticalAlerts: false, allowsSound: true },
    });
    const { readSirenReadiness } = await import('./pushNotifications');

    const readiness = await readSirenReadiness();

    expect(readiness.permission).toBe('denied');
    expect(readiness.canAskAgain).toBe(false);
    expect(readiness.criticalAlerts).toBe('not-allowed');
    expect(readiness.doNotDisturb).toBe('unknown');
    expect(readiness.channel).toBeNull();
    expect(getNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('returns unknowns and the reason when the siren cannot be tested here', async () => {
    mocks.platform.OS = 'web';
    const { readSirenReadiness } = await import('./pushNotifications');

    const readiness = await readSirenReadiness();

    expect(readiness.availability.available).toBe(false);
    expect(readiness.availability.reason).toContain('iOS or Android app');
    expect(readiness.permission).toBe('unknown');
    expect(readiness.doNotDisturb).toBe('unknown');
    expect(getPermissionsAsync).not.toHaveBeenCalled();
  });
});
