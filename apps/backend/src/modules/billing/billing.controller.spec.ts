import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { BillingStore } from '@prisma/client';
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

const validEvent = {
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
};

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  );
}

/** `null` builds a controller with no webhook token configured at all. */
function fixture(webhookToken: string | null = 'revenuecat-webhook-token') {
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
      revenueCatWebhookAuthToken: webhookToken ?? undefined,
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

    await expect(
      test.controller.handleRevenueCatWebhook('Bearer wrong-token', undefined, { event: {} }),
    ).rejects.toThrow('RevenueCat webhook authorization is required');
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
    const { id: _omitted, ...eventWithoutId } = validEvent;
    void _omitted;

    await expect(
      test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, {
        event: eventWithoutId,
      }),
    ).rejects.toThrow('RevenueCat webhook payload is invalid');
  });
});

describe('BillingController webhook auth and payload errors (CB-026)', () => {
  it('answers 400 for a malformed payload once the token is right', async () => {
    const test = fixture();

    for (const body of [
      undefined,
      {},
      { event: null },
      { event: 'INITIAL_PURCHASE' },
      { event: { ...validEvent, purchased_at_ms: 'yesterday' } },
      { event: { ...validEvent, purchased_at_ms: 0 } },
      { event: { ...validEvent, transaction_id: '' } },
      { event: { ...validEvent, app_user_id: 42 } },
    ]) {
      const error = await rejectionOf(
        test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, body as never),
      );
      expect(error, JSON.stringify(body)).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
    expect(test.calls.some((call) => typeof call === 'object' && call && 'syncRevenueCatEvent' in call)).toBe(false);
  });

  it('answers 401, never 400, for a wrong or missing token, even with a malformed payload', async () => {
    const test = fixture();

    for (const [authorization, body] of [
      ['Bearer wrong-token', { event: validEvent }],
      ['Bearer wrong-token', {}],
      ['Bearer revenuecat-webhook-toke', { event: validEvent }],
      ['Bearer revenuecat-webhook-token-longer', { event: validEvent }],
      ['revenuecat-webhook-tokeX', { event: validEvent }],
      [undefined, { event: validEvent }],
      ['Bearer ', { event: validEvent }],
    ] as const) {
      const error = await rejectionOf(test.controller.handleRevenueCatWebhook(authorization, undefined, body));
      expect(error, String(authorization)).toBeInstanceOf(UnauthorizedException);
    }
  });

  it('answers 401 when no webhook token is configured at all', async () => {
    const test = fixture(null);

    const error = await rejectionOf(
      test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, { event: validEvent }),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the token from x-revenuecat-authorization, with or without the Bearer prefix', async () => {
    const test = fixture();

    await expect(
      test.controller.handleRevenueCatWebhook(undefined, 'revenuecat-webhook-token', { event: validEvent }),
    ).resolves.toEqual({ processed: true });
    await expect(
      test.controller.handleRevenueCatWebhook(undefined, 'Bearer revenuecat-webhook-token', { event: validEvent }),
    ).resolves.toEqual({ processed: true });
  });

  it('drops non-string entitlement ids and unset optional fields instead of failing', async () => {
    const test = fixture();

    await expect(
      test.controller.handleRevenueCatWebhook('Bearer revenuecat-webhook-token', undefined, {
        event: {
          ...validEvent,
          entitlement_ids: ['nearby_access', 7, ''] as never,
          expiration_at_ms: null,
          period_type: null,
        },
      }),
    ).resolves.toEqual({ processed: true });

    expect(test.calls).toContainEqual({
      syncRevenueCatEvent: expect.objectContaining({
        entitlementIds: ['nearby_access'],
        expirationAt: null,
        periodType: null,
      }),
    });
  });
});
