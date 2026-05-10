export type RevenueCatPurchaseInterval = 'MONTHLY' | 'ANNUAL';

export interface RevenueCatPlanPackage {
  identifier: string;
  packageType: string;
  product?: {
    title?: string;
    description?: string;
    priceString?: string;
  };
}

export interface RevenueCatPlanOffering {
  availablePackages: RevenueCatPlanPackage[];
  monthly?: RevenueCatPlanPackage | null;
  annual?: RevenueCatPlanPackage | null;
}

export interface RevenueCatPlanOption {
  interval: RevenueCatPurchaseInterval;
  name: string;
  description: string;
  price: string | null;
  packageIdentifier: string;
}

export function revenueCatPlanOptionsFromOffering(offering?: RevenueCatPlanOffering | null): RevenueCatPlanOption[] {
  const plans: RevenueCatPlanOption[] = [];
  const monthly = offering?.monthly;
  const annual = offering?.annual;

  if (monthly) {
    plans.push(planOption('MONTHLY', 'Monthly', 'Flexible monthly access through App Store or Google Play billing.', monthly));
  }
  if (annual) {
    plans.push(planOption('ANNUAL', 'Annual', 'One yearly subscription through App Store or Google Play billing.', annual));
  }

  return plans;
}

function planOption(
  interval: RevenueCatPurchaseInterval,
  fallbackName: string,
  fallbackDescription: string,
  pkg: RevenueCatPlanPackage,
): RevenueCatPlanOption {
  return {
    interval,
    name: pkg.product?.title || fallbackName,
    description: pkg.product?.description || fallbackDescription,
    price: pkg.product?.priceString ?? null,
    packageIdentifier: pkg.identifier,
  };
}
