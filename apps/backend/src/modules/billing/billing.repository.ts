import type { BillingInterval, BillingStore, SubscriptionStatus, SubscriptionTier } from '@prisma/client';

export interface UserBillingProfile {
  id: string;
}

export interface LocalSubscriptionRecord {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paymentProvider: string;
  externalSubscriptionId: string;
  externalProductId: string | null;
  revenueCatAppUserId: string | null;
  billingInterval: BillingInterval | null;
  store: BillingStore | null;
  willRenew: boolean;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
}

export interface UpsertRevenueCatSubscriptionInput {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  paymentProvider: string;
  externalSubscriptionId: string;
  externalProductId: string;
  revenueCatAppUserId: string;
  billingInterval: BillingInterval;
  store: BillingStore;
  willRenew: boolean;
  trialEndsAt: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
}

export interface BillingRepository {
  findUserBillingProfile(userId: string): Promise<UserBillingProfile | null>;
  findLatestSubscriptionForUser(userId: string): Promise<LocalSubscriptionRecord | null>;
  recordRevenueCatEventProcessed(input: { eventId: string; expiresAt: Date }): Promise<boolean>;
  upsertRevenueCatSubscription(input: UpsertRevenueCatSubscriptionInput): Promise<LocalSubscriptionRecord>;
}
