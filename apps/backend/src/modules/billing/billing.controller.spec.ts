import { BillingInterval, BillingStore, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../shared/config/app-config.service';
import type { SupabaseAuthService } from '../auth/supabase-auth.service';
import type { UsersService } from '../users/users.service';
import type { BillingService } from './billing.service';
import { BillingController } from './billing.controller';

const sender = {
  id: 'user-1',
  authProviderId: 'auth-1',
  emailEncrypted: 'email',
  emailHash: 'email-hash',
  phoneEncrypted: 'phone',
  phoneHash: 'phone-hash',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

function fixture() {
  const calls: unknown[] = [];
  const controller = new BillingController(
    {
      verifyAccessToken: async (token: string) => {
        calls.push({ verifyAccessToken: token });
        return {
          authProviderId: 'auth-1',
          email: 'sender@example.com',
          phone: '+971501234567',
          country: 'AE',
          preferredLanguage: 'en',
          timezone: 'Asia/Dubai',
        };
      },
    } as unknown as SupabaseAuthService,
    {
      upsertFromSupabaseIdentity: async () => {
        calls.push({ upsert: true });
        return sender;
      },
    } as unknown as UsersService,
    {
      getBillingStatus: async (userId: string) => {
        calls.push({ getBillingStatus: userId });
        return { entitled: false, revenueCatAppUserId: userId, subscription: null };
      },
      syncRevenueCatEvent: async (event: unknown) => {
        calls.push({ syncRevenueCatEvent: event });
        return { processed: true };
      },
    } as unknown as BillingService,
    {
      revenueCatWebhookAuthToken: 'revenuecat-webhook-token',
    } as unknown as AppConfigService,
  );

  return { controller, calls };
}

describe('BillingController', () => {
  it('returns billing status for authenticated senders', async () => {
    const test = fixture();

    await expect(test.controller.getBillingStatus('Bearer access-token')).resolves.toEqual({
      entitled: false,
      revenueCatAppUserId: 'user-1',
      subscription: null,
    });

    expect(test.calls).toContainEqual({ verifyAccessToken: 'access-token' });
    expect(test.calls).toContainEqual({ getBillingStatus: 'user-1' });
  });

  it('rejects RevenueCat webhooks without the configured authorization token', async () => {
    const test = fixture();

    await expect(test.controller.handleRevenueCatWebhook('Bearer wrong-token', undefined, { event: {} })).rejects.toThrow(
      'RevenueCat webhook authorization is required',
    );
  });

  it('maps RevenueCat webhook payloads into billing service events', async () => {
    const test = fixture();

    await expect(
      test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, {
        event: {
          type: 'INITIAL_PURCHASE',
          id: 'event-initial-1',
          app_user_id: 'user-1',
          product_id: 'nearby_tier2_annual',
          entitlement_ids: ['nearby_access'],
          store: 'APP_STORE',
          purchased_at_ms: Date.parse('2026-05-01T00:00:00.000Z'),
          expiration_at_ms: Date.parse('2027-05-01T00:00:00.000Z'),
          period_type: 'NORMAL',
          transaction_id: 'transaction-1',
        },
      }),
    ).resolves.toEqual({ processed: true });

    expect(test.calls).toContainEqual({
      syncRevenueCatEvent: {
        type: 'INITIAL_PURCHASE',
        eventId: 'event-initial-1',
        appUserId: 'user-1',
        productId: 'nearby_tier2_annual',
        entitlementIds: ['nearby_access'],
        store: BillingStore.APP_STORE,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expirationAt: new Date('2027-05-01T00:00:00.000Z'),
        periodType: 'NORMAL',
        transactionId: 'transaction-1',
      },
    });
  });

  it('rejects RevenueCat webhook payloads without an event id', async () => {
    const test = fixture();

    await expect(
      test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, {
        event: {
          type: 'INITIAL_PURCHASE',
          app_user_id: 'user-1',
          product_id: 'nearby_tier2_annual',
          entitlement_ids: ['nearby_access'],
          store: 'APP_STORE',
          purchased_at_ms: Date.parse('2026-05-01T00:00:00.000Z'),
          expiration_at_ms: Date.parse('2027-05-01T00:00:00.000Z'),
          period_type: 'NORMAL',
          transaction_id: 'transaction-1',
        },
      }),
    ).rejects.toThrow('RevenueCat webhook payload is invalid');
  });
});
