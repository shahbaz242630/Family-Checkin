import { Inject, Injectable } from '@nestjs/common';
import { ActorType, BillingInterval, BillingStore, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { BillingRepository, LocalSubscriptionRecord, UpsertRevenueCatSubscriptionInput } from './billing.repository';
import { BILLING_REPOSITORY } from './billing.tokens';

export interface BillingStatusResponse {
  entitled: boolean;
  revenueCatAppUserId: string;
  subscription: {
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    billingInterval: BillingInterval | null;
    store: BillingStore | null;
    currentPeriodEnd: string;
    willRenew: boolean;
  } | null;
}

export interface RevenueCatWebhookEvent {
  type: string;
  eventId: string;
  appUserId: string;
  productId: string;
  entitlementIds: string[];
  store: BillingStore;
  purchasedAt: Date;
  expirationAt: Date | null;
  periodType: string | null;
  transactionId: string;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly billingRepository: BillingRepository,
    @Inject(AuditService) private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
    private readonly entitlementId = 'nearby_access',
  ) {}

  async getBillingStatus(userId: string): Promise<BillingStatusResponse> {
    const subscription = await this.billingRepository.findLatestSubscriptionForUser(userId);
    if (!subscription) {
      return { entitled: false, revenueCatAppUserId: userId, subscription: null };
    }

    return {
      entitled: this.isEntitled(subscription),
      revenueCatAppUserId: userId,
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        billingInterval: subscription.billingInterval,
        store: subscription.store,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        willRenew: subscription.willRenew,
      },
    };
  }

  async syncRevenueCatEvent(event: RevenueCatWebhookEvent): Promise<{ processed: boolean }> {
    if (!event.entitlementIds.includes(this.entitlementId)) {
      return { processed: false };
    }
    const user = await this.billingRepository.findUserBillingProfile(event.appUserId);
    if (!user) {
      throw new Error('RevenueCat app user id does not match a synced backend user');
    }

    const recorded = await this.billingRepository.recordRevenueCatEventProcessed({
      eventId: event.eventId,
      expiresAt: new Date(this.now().getTime() + 90 * 24 * 60 * 60 * 1000),
    });
    if (!recorded) {
      return { processed: false };
    }

    const status = this.statusFromRevenueCatEvent(event);
    const currentPeriodEnd = event.expirationAt ?? event.purchasedAt;
    const input: UpsertRevenueCatSubscriptionInput = {
      userId: event.appUserId,
      tier: this.tierFromProductId(event.productId),
      status,
      paymentProvider: 'revenuecat',
      externalSubscriptionId: event.transactionId,
      externalProductId: event.productId,
      revenueCatAppUserId: event.appUserId,
      billingInterval: this.intervalFromProductId(event.productId),
      store: event.store,
      willRenew: this.willRenewFromRevenueCatEvent(event),
      trialEndsAt: event.periodType === 'TRIAL' ? currentPeriodEnd : null,
      currentPeriodStart: event.purchasedAt,
      currentPeriodEnd,
      canceledAt: status === SubscriptionStatus.CANCELED ? this.now() : null,
    };

    await this.billingRepository.upsertRevenueCatSubscription(input);
    await this.auditService.append({
      entityType: 'user',
      entityId: event.appUserId,
      action: 'billing.revenuecat_subscription_synced',
      actorType: ActorType.SYSTEM,
      metadata: {
        provider: 'revenuecat',
        eventType: event.type,
        status,
        tier: input.tier,
        billingInterval: input.billingInterval,
        store: input.store,
        willRenew: input.willRenew,
      },
    });

    return { processed: true };
  }

  private isEntitled(subscription: LocalSubscriptionRecord): boolean {
    const now = this.now();
    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return subscription.currentPeriodEnd > now;
    }
    if (subscription.status === SubscriptionStatus.TRIALING) {
      return (subscription.trialEndsAt ?? subscription.currentPeriodEnd) > now;
    }
    if (subscription.status === SubscriptionStatus.CANCELED) {
      return subscription.currentPeriodEnd > now;
    }
    if (subscription.status === SubscriptionStatus.PAST_DUE) {
      return subscription.currentPeriodEnd > now;
    }
    return false;
  }

  private statusFromRevenueCatEvent(event: RevenueCatWebhookEvent): SubscriptionStatus {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'PRODUCT_CHANGE':
        return event.periodType === 'TRIAL' ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
      case 'CANCELLATION':
        return SubscriptionStatus.CANCELED;
      case 'EXPIRATION':
        return SubscriptionStatus.CANCELED;
      case 'BILLING_ISSUE':
        return SubscriptionStatus.PAST_DUE;
      default:
        return event.expirationAt && event.expirationAt > this.now() ? SubscriptionStatus.ACTIVE : SubscriptionStatus.CANCELED;
    }
  }

  private willRenewFromRevenueCatEvent(event: RevenueCatWebhookEvent): boolean {
    return !['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'].includes(event.type);
  }

  private intervalFromProductId(productId: string): BillingInterval {
    return /annual|year/i.test(productId) ? BillingInterval.ANNUAL : BillingInterval.MONTHLY;
  }

  private tierFromProductId(productId: string): SubscriptionTier {
    if (/tier[_-]?3|premium|family/i.test(productId)) {
      return SubscriptionTier.TIER_3;
    }
    if (/tier[_-]?2|plus/i.test(productId)) {
      return SubscriptionTier.TIER_2;
    }
    return SubscriptionTier.TIER_1;
  }
}
