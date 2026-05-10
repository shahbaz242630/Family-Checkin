import { BillingInterval, BillingStore, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { BillingRepository, LocalSubscriptionRecord, UpsertRevenueCatSubscriptionInput } from './billing.repository';
import { BillingService } from './billing.service';

class FakeBillingRepository implements BillingRepository {
  public subscription: LocalSubscriptionRecord | null = null;
  public upserted: UpsertRevenueCatSubscriptionInput | null = null;
  public processedEventIds = new Set<string>();
  public knownUserIds = new Set<string>(['user-1']);

  async findUserBillingProfile(userId: string) {
    return this.knownUserIds.has(userId) ? { id: userId } : null;
  }

  async findLatestSubscriptionForUser() {
    return this.subscription;
  }

  async recordRevenueCatEventProcessed(input: { eventId: string; expiresAt: Date }) {
    if (this.processedEventIds.has(input.eventId)) {
      return false;
    }
    this.processedEventIds.add(input.eventId);
    return true;
  }

  async upsertRevenueCatSubscription(input: UpsertRevenueCatSubscriptionInput) {
    this.upserted = input;
    this.subscription = {
      id: 'local-subscription-1',
      ...input,
    };
    return this.subscription;
  }
}

function subscription(status: SubscriptionStatus, overrides: Partial<LocalSubscriptionRecord> = {}): LocalSubscriptionRecord {
  return {
    id: 'subscription-1',
    userId: 'user-1',
    tier: SubscriptionTier.TIER_1,
    status,
    paymentProvider: 'revenuecat',
    externalSubscriptionId: 'transaction-1',
    externalProductId: 'nearby_tier1_monthly',
    revenueCatAppUserId: 'user-1',
    billingInterval: BillingInterval.MONTHLY,
    store: BillingStore.APP_STORE,
    willRenew: true,
    trialEndsAt: null,
    currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
    canceledAt: null,
    ...overrides,
  };
}

function fixture() {
  const repository = new FakeBillingRepository();
  const auditEvents: unknown[] = [];
  const service = new BillingService(
    repository,
    {
      append: async (event: unknown) => {
        auditEvents.push(event);
        return {} as never;
      },
    } as unknown as AuditService,
    () => new Date('2026-05-09T12:00:00.000Z'),
  );
  return { service, repository, auditEvents };
}

describe('BillingService', () => {
  it('grants entitlement only for active, trialing, or paid-through canceled subscriptions', async () => {
    const test = fixture();

    test.repository.subscription = null;
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({
      entitled: false,
      revenueCatAppUserId: 'user-1',
    });

    test.repository.subscription = subscription(SubscriptionStatus.ACTIVE);
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: true });

    test.repository.subscription = subscription(SubscriptionStatus.TRIALING, { trialEndsAt: new Date('2026-05-20T00:00:00.000Z') });
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: true });

    test.repository.subscription = subscription(SubscriptionStatus.CANCELED, { willRenew: false });
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: true });

    test.repository.subscription = subscription(SubscriptionStatus.CANCELED, {
      currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
      willRenew: false,
    });
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: false });

    test.repository.subscription = subscription(SubscriptionStatus.PAST_DUE, { currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z') });
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: false });
  });

  it('keeps past-due subscriptions entitled through the paid retry grace window', async () => {
    const test = fixture();

    test.repository.subscription = subscription(SubscriptionStatus.PAST_DUE, {
      currentPeriodEnd: new Date('2026-05-16T00:00:00.000Z'),
      willRenew: false,
    });

    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: true });
  });

  it('ignores RevenueCat webhooks for unrelated entitlements', async () => {
    const test = fixture();

    await expect(
      test.service.syncRevenueCatEvent({
        type: 'INITIAL_PURCHASE',
        eventId: 'event-unrelated-1',
        appUserId: 'user-1',
        productId: 'nearby_tier1_monthly',
        entitlementIds: ['other_product'],
        store: BillingStore.APP_STORE,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expirationAt: new Date('2026-06-01T00:00:00.000Z'),
        periodType: 'NORMAL',
        transactionId: 'transaction-1',
      }),
    ).resolves.toEqual({ processed: false });

    expect(test.repository.upserted).toBeNull();
    expect(test.auditEvents).toHaveLength(0);
  });

  it('syncs RevenueCat renewal webhooks into annual local subscription state', async () => {
    const test = fixture();

    await expect(
      test.service.syncRevenueCatEvent({
        type: 'RENEWAL',
        eventId: 'event-renewal-1',
        appUserId: 'user-1',
        productId: 'nearby_tier2_annual',
        entitlementIds: ['nearby_access'],
        store: BillingStore.PLAY_STORE,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expirationAt: new Date('2027-05-01T00:00:00.000Z'),
        periodType: 'NORMAL',
        transactionId: 'transaction-annual-1',
      }),
    ).resolves.toEqual({ processed: true });

    expect(test.repository.upserted).toMatchObject({
      userId: 'user-1',
      tier: SubscriptionTier.TIER_2,
      status: SubscriptionStatus.ACTIVE,
      externalSubscriptionId: 'transaction-annual-1',
      externalProductId: 'nearby_tier2_annual',
      revenueCatAppUserId: 'user-1',
      billingInterval: BillingInterval.ANNUAL,
      store: BillingStore.PLAY_STORE,
      willRenew: true,
    });
    expect(test.auditEvents).toHaveLength(1);
  });

  it('marks billing issues as past due while preserving paid-through grace access', async () => {
    const test = fixture();

    await test.service.syncRevenueCatEvent({
      type: 'BILLING_ISSUE',
      eventId: 'event-billing-issue-1',
      appUserId: 'user-1',
      productId: 'nearby_tier1_monthly',
      entitlementIds: ['nearby_access'],
      store: BillingStore.APP_STORE,
      purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
      expirationAt: new Date('2026-06-01T00:00:00.000Z'),
      periodType: 'NORMAL',
      transactionId: 'transaction-monthly-1',
    });

    expect(test.repository.upserted).toMatchObject({
      status: SubscriptionStatus.PAST_DUE,
      willRenew: false,
    });
    await expect(test.service.getBillingStatus('user-1')).resolves.toMatchObject({ entitled: true });
  });

  it('skips duplicate RevenueCat webhook deliveries by event id', async () => {
    const test = fixture();
    const event = {
      type: 'RENEWAL',
      eventId: 'event-renewal-duplicate',
      appUserId: 'user-1',
      productId: 'nearby_tier1_monthly',
      entitlementIds: ['nearby_access'],
      store: BillingStore.APP_STORE,
      purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
      expirationAt: new Date('2026-06-01T00:00:00.000Z'),
      periodType: 'NORMAL',
      transactionId: 'transaction-monthly-1',
    };

    await expect(test.service.syncRevenueCatEvent(event)).resolves.toEqual({ processed: true });
    await expect(test.service.syncRevenueCatEvent(event)).resolves.toEqual({ processed: false });

    expect(test.auditEvents).toHaveLength(1);
  });

  it('rejects RevenueCat events whose app user id is not a synced backend user id', async () => {
    const test = fixture();
    test.repository.knownUserIds.clear();

    await expect(
      test.service.syncRevenueCatEvent({
        type: 'INITIAL_PURCHASE',
        eventId: 'event-unknown-user',
        appUserId: 'supabase-auth-user-id',
        productId: 'nearby_tier1_monthly',
        entitlementIds: ['nearby_access'],
        store: BillingStore.APP_STORE,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expirationAt: new Date('2026-06-01T00:00:00.000Z'),
        periodType: 'NORMAL',
        transactionId: 'transaction-monthly-1',
      }),
    ).rejects.toThrow('RevenueCat app user id does not match a synced backend user');

    expect(test.repository.upserted).toBeNull();
    expect(test.auditEvents).toHaveLength(0);
  });
});
