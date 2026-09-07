import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revenueCatPlanOptionsFromOffering } from './revenueCatPlans';
import { pollBillingStatusUntilEntitled, BILLING_POLL_TIMEOUT_MS, type BillingPollOptions } from './billingPolling';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' as string },
}));

const configure = vi.fn();
const logIn = vi.fn();
const logOut = vi.fn();
const getOfferings = vi.fn();
const purchasePackage = vi.fn();
const restorePurchases = vi.fn();

vi.mock('react-native', () => ({
  Platform: mocks.platform,
}));

vi.mock('react-native-purchases', () => ({
  default: {
    configure,
    logIn,
    logOut,
    getOfferings,
    purchasePackage,
    restorePurchases,
  },
}));

describe('revenueCatPlanOptionsFromOffering', () => {
  it('maps monthly and annual RevenueCat packages to displayable plan options', () => {
    expect(
      revenueCatPlanOptionsFromOffering({
        availablePackages: [],
        monthly: {
          identifier: '$rc_monthly',
          packageType: 'MONTHLY',
          product: {
            title: 'Nearby Monthly',
            description: 'Monthly Nearby access',
            priceString: '$4.99',
          },
        },
        annual: {
          identifier: '$rc_annual',
          packageType: 'ANNUAL',
          product: {
            title: 'Nearby Annual',
            description: 'Annual Nearby access',
            priceString: '$49.99',
          },
        },
      }),
    ).toEqual([
      {
        interval: 'MONTHLY',
        name: 'Nearby Monthly',
        description: 'Monthly Nearby access',
        price: '$4.99',
        packageIdentifier: '$rc_monthly',
      },
      {
        interval: 'ANNUAL',
        name: 'Nearby Annual',
        description: 'Annual Nearby access',
        price: '$49.99',
        packageIdentifier: '$rc_annual',
      },
    ]);
  });

  it('uses stable copy when RevenueCat product metadata is missing', () => {
    expect(
      revenueCatPlanOptionsFromOffering({
        availablePackages: [],
        monthly: {
          identifier: '$rc_monthly',
          packageType: 'MONTHLY',
        },
      }),
    ).toEqual([
      {
        interval: 'MONTHLY',
        name: 'Monthly',
        description: 'Flexible monthly access through App Store or Google Play billing.',
        price: null,
        packageIdentifier: '$rc_monthly',
      },
    ]);
  });
});

describe('RevenueCat identity (CB-041)', () => {
  beforeEach(() => {
    mocks.platform.OS = 'ios';
    vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'appl_test_key');
    logIn.mockResolvedValue({});
    logOut.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('configures RevenueCat once and logs the first sender in through configure', async () => {
    const { configureRevenueCat } = await import('./revenueCat');

    await expect(configureRevenueCat('user-1')).resolves.toEqual({ configured: true });
    await expect(configureRevenueCat('user-1')).resolves.toEqual({ configured: true });

    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({ apiKey: 'appl_test_key', appUserID: 'user-1' });
    expect(logIn).not.toHaveBeenCalled();
  });

  it('switches senders with logIn instead of configuring a second time', async () => {
    const { configureRevenueCat } = await import('./revenueCat');

    await configureRevenueCat('user-1');
    await configureRevenueCat('user-2');

    expect(configure).toHaveBeenCalledTimes(1);
    expect(logIn).toHaveBeenCalledTimes(1);
    expect(logIn).toHaveBeenCalledWith('user-2');
  });

  it('logs out so the next sender on the device does not inherit the identity', async () => {
    const { configureRevenueCat, logOutRevenueCat } = await import('./revenueCat');

    await configureRevenueCat('user-1');
    await logOutRevenueCat();

    expect(logOut).toHaveBeenCalledTimes(1);

    // Signing back in must not configure() again — the SDK is already up.
    await configureRevenueCat('user-1');
    expect(configure).toHaveBeenCalledTimes(1);
    expect(logIn).toHaveBeenCalledWith('user-1');
  });

  it('does not call logOut when RevenueCat was never configured', async () => {
    const { logOutRevenueCat } = await import('./revenueCat');

    await logOutRevenueCat();

    expect(logOut).not.toHaveBeenCalled();
  });

  it('reports RevenueCat as unconfigured on web instead of touching the SDK', async () => {
    mocks.platform.OS = 'web';
    const { configureRevenueCat } = await import('./revenueCat');

    const availability = await configureRevenueCat('user-1');

    expect(availability.configured).toBe(false);
    expect(configure).not.toHaveBeenCalled();
  });

  it('reports RevenueCat as unconfigured when the platform has no public API key', async () => {
    vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', '');
    const { configureRevenueCat } = await import('./revenueCat');

    const availability = await configureRevenueCat('user-1');

    expect(availability.configured).toBe(false);
    expect(availability.reason).toContain('public API key');
    expect(configure).not.toHaveBeenCalled();
  });
});

describe('post-purchase billing status polling (CB-041)', () => {
  type PolledStatus = { entitled: boolean; tier?: string };

  /** A fake clock that only advances when the poller waits, so tests are instant. */
  function deps(
    overrides: Partial<BillingPollOptions<PolledStatus>> & { fetchStatus: () => Promise<PolledStatus> },
  ): BillingPollOptions<PolledStatus> {
    let clock = 0;
    return {
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
      isEntitled: (status: PolledStatus) => status.entitled,
      ...overrides,
    };
  }

  it('stops as soon as the backend reports the purchase as entitled', async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ entitled: false })
      .mockResolvedValueOnce({ entitled: false })
      .mockResolvedValue({ entitled: true });

    const result = await pollBillingStatusUntilEntitled(deps({ fetchStatus }));

    expect(result.entitled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.attempts).toBe(3);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('gives up after the one-minute window instead of polling forever', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ entitled: false });

    const result = await pollBillingStatusUntilEntitled(deps({ fetchStatus }));

    expect(result.entitled).toBe(false);
    expect(result.timedOut).toBe(true);
    // 3 s apart across a 60 s window, and never past the deadline.
    expect(result.attempts).toBe(BILLING_POLL_TIMEOUT_MS / 3_000);
  });

  it('keeps polling through a failed status read and reports the last error', async () => {
    const failure = new Error('Network request failed');
    const fetchStatus = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ entitled: true });

    const result = await pollBillingStatusUntilEntitled(deps({ fetchStatus }));

    expect(result.entitled).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
  });

  it('surfaces the failure when every read failed', async () => {
    const failure = new Error('Network request failed');
    const fetchStatus = vi.fn().mockRejectedValue(failure);

    const result = await pollBillingStatusUntilEntitled(deps({ fetchStatus, timeoutMs: 9_000 }));

    expect(result.entitled).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.status).toBeNull();
    expect(result.lastError).toBe(failure);
  });

  it('reports each status it reads so the screen can update while polling', async () => {
    const onStatus = vi.fn();
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce({ entitled: false, tier: 'none' })
      .mockResolvedValue({ entitled: true, tier: 'TIER_1' });

    await pollBillingStatusUntilEntitled(deps({ fetchStatus, onStatus }));

    expect(onStatus).toHaveBeenNthCalledWith(1, { entitled: false, tier: 'none' });
    expect(onStatus).toHaveBeenNthCalledWith(2, { entitled: true, tier: 'TIER_1' });
  });

  it('stops immediately when the caller cancels, without another read', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ entitled: false });
    let cancelled = false;

    const result = await pollBillingStatusUntilEntitled(
      deps({
        fetchStatus,
        isCancelled: () => {
          const previous = cancelled;
          cancelled = true;
          return previous;
        },
      }),
    );

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
