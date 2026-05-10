import { describe, expect, it } from 'vitest';
import { revenueCatPlanOptionsFromOffering } from './revenueCatPlans';

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
