import { Platform } from 'react-native';
import {
  revenueCatPlanOptionsFromOffering,
  type RevenueCatPlanOffering,
  type RevenueCatPlanOption,
  type RevenueCatPlanPackage,
  type RevenueCatPurchaseInterval,
} from './revenueCatPlans';

const iosApiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const androidApiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const entitlementId = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID ?? 'nearby_access';

type PurchasesPackage = RevenueCatPlanPackage;

type PurchasesOffering = RevenueCatPlanOffering;

type PurchasesCustomerInfo = {
  entitlements?: {
    active?: Record<string, unknown>;
  };
};

type PurchasesModule = {
  default?: PurchasesModule;
  configure(input: { apiKey: string; appUserID?: string }): void;
  logIn?(appUserID: string): Promise<unknown>;
  logOut?(): Promise<unknown>;
  getOfferings(): Promise<{ current?: PurchasesOffering | null }>;
  purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: PurchasesCustomerInfo }>;
  restorePurchases(): Promise<PurchasesCustomerInfo>;
};

export type { RevenueCatPlanOption, RevenueCatPurchaseInterval };

export interface RevenueCatBillingAvailability {
  configured: boolean;
  reason?: string;
}

const NATIVE_MODULE_REASON = 'RevenueCat native module is unavailable. Use a development or store build.';
const NO_IDENTITY_SWITCH_REASON =
  'This build of react-native-purchases cannot switch RevenueCat users. Reopen the app after signing in again.';

// `Purchases.configure` is a once-per-process call. Switching senders is
// `logIn`/`logOut`; calling `configure` a second time is the CB-041 bug.
let configuredApiKey: string | null = null;
let currentAppUserId: string | null = null;

export function revenueCatAvailability(): RevenueCatBillingAvailability {
  if (Platform.OS === 'web') {
    return { configured: false, reason: 'RevenueCat purchases require an iOS or Android build.' };
  }

  if (!currentApiKey()) {
    return { configured: false, reason: 'RevenueCat public API key is not configured for this platform.' };
  }

  return { configured: true };
}

export async function configureRevenueCat(userId: string): Promise<RevenueCatBillingAvailability> {
  const availability = revenueCatAvailability();
  if (!availability.configured) {
    return availability;
  }

  const purchases = await loadPurchases();
  if (!purchases) {
    return { configured: false, reason: NATIVE_MODULE_REASON };
  }

  const apiKey = currentApiKey() ?? '';

  if (configuredApiKey !== apiKey) {
    purchases.configure({ apiKey, appUserID: userId });
    configuredApiKey = apiKey;
    currentAppUserId = userId;
    return { configured: true };
  }

  if (currentAppUserId !== userId) {
    if (typeof purchases.logIn !== 'function') {
      return { configured: false, reason: NO_IDENTITY_SWITCH_REASON };
    }
    await purchases.logIn(userId);
    currentAppUserId = userId;
  }

  return { configured: true };
}

/**
 * Detaches the RevenueCat SDK from the signed-out sender so the next sender on
 * this device does not inherit the previous identity. Safe to call when
 * RevenueCat was never configured.
 */
export async function logOutRevenueCat(): Promise<void> {
  if (currentAppUserId === null) {
    return;
  }

  currentAppUserId = null;

  const purchases = await loadPurchases();
  if (typeof purchases?.logOut === 'function') {
    await purchases.logOut();
  }
}

export async function purchaseRevenueCatPackage(
  userId: string,
  interval: RevenueCatPurchaseInterval,
): Promise<{ entitled: boolean }> {
  const availability = await configureRevenueCat(userId);
  if (!availability.configured) {
    throw new Error(availability.reason ?? 'RevenueCat is not configured');
  }

  const purchases = await requirePurchases();
  const offering = (await purchases.getOfferings()).current;
  const selectedPackage = interval === 'ANNUAL' ? offering?.annual : offering?.monthly;
  if (!selectedPackage) {
    throw new Error(`${interval === 'ANNUAL' ? 'Annual' : 'Monthly'} RevenueCat package is not configured`);
  }

  const result = await purchases.purchasePackage(selectedPackage);
  return { entitled: hasNearbyEntitlement(result.customerInfo) };
}

export async function getRevenueCatPlanOptions(userId: string): Promise<RevenueCatPlanOption[]> {
  const availability = await configureRevenueCat(userId);
  if (!availability.configured) {
    return [];
  }

  const purchases = await requirePurchases();
  const offering = (await purchases.getOfferings()).current;
  return revenueCatPlanOptionsFromOffering(offering);
}

export async function restoreRevenueCatPurchases(userId: string): Promise<{ entitled: boolean }> {
  const availability = await configureRevenueCat(userId);
  if (!availability.configured) {
    throw new Error(availability.reason ?? 'RevenueCat is not configured');
  }

  const purchases = await requirePurchases();
  const customerInfo = await purchases.restorePurchases();
  return { entitled: hasNearbyEntitlement(customerInfo) };
}

async function requirePurchases(): Promise<PurchasesModule> {
  const purchases = await loadPurchases();
  if (!purchases) {
    throw new Error(NATIVE_MODULE_REASON);
  }
  return purchases;
}

async function loadPurchases(): Promise<PurchasesModule | null> {
  try {
    const module = (await import('react-native-purchases')) as unknown as PurchasesModule;
    return module.default ?? module;
  } catch {
    return null;
  }
}

function hasNearbyEntitlement(customerInfo: PurchasesCustomerInfo): boolean {
  return Boolean(customerInfo.entitlements?.active?.[entitlementId]);
}

function currentApiKey(): string | undefined {
  if (Platform.OS === 'ios') {
    return iosApiKey || undefined;
  }
  if (Platform.OS === 'android') {
    return androidApiKey || undefined;
  }
  return undefined;
}
