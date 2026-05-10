import { Inject, Injectable } from '@nestjs/common';
import type { Subscription } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { BillingRepository, LocalSubscriptionRecord, UpsertRevenueCatSubscriptionInput, UserBillingProfile } from './billing.repository';

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findUserBillingProfile(userId: string): Promise<UserBillingProfile | null> {
    return await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
  }

  async findLatestSubscriptionForUser(userId: string): Promise<LocalSubscriptionRecord | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { currentPeriodEnd: 'desc' },
    });

    return subscription ? this.toLocalSubscriptionRecord(subscription) : null;
  }

  async recordRevenueCatEventProcessed(input: { eventId: string; expiresAt: Date }): Promise<boolean> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: `revenuecat:${input.eventId}`,
          scope: 'billing.revenuecat_webhook',
          expiresAt: input.expiresAt,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async upsertRevenueCatSubscription(input: UpsertRevenueCatSubscriptionInput): Promise<LocalSubscriptionRecord> {
    const subscription = await this.prisma.subscription.upsert({
      where: { externalSubscriptionId: input.externalSubscriptionId },
      create: {
        userId: input.userId,
        tier: input.tier,
        status: input.status,
        paymentProvider: 'revenuecat',
        externalSubscriptionId: input.externalSubscriptionId,
        externalProductId: input.externalProductId,
        revenueCatAppUserId: input.revenueCatAppUserId,
        billingInterval: input.billingInterval,
        store: input.store,
        willRenew: input.willRenew,
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        canceledAt: input.canceledAt,
      },
      update: {
        tier: input.tier,
        status: input.status,
        paymentProvider: 'revenuecat',
        externalProductId: input.externalProductId,
        revenueCatAppUserId: input.revenueCatAppUserId,
        billingInterval: input.billingInterval,
        store: input.store,
        willRenew: input.willRenew,
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        canceledAt: input.canceledAt,
      },
    });

    return this.toLocalSubscriptionRecord(subscription);
  }

  private toLocalSubscriptionRecord(subscription: Subscription): LocalSubscriptionRecord {
    return {
      id: subscription.id,
      userId: subscription.userId,
      tier: subscription.tier,
      status: subscription.status,
      paymentProvider: subscription.paymentProvider,
      externalSubscriptionId: subscription.externalSubscriptionId,
      externalProductId: subscription.externalProductId,
      revenueCatAppUserId: subscription.revenueCatAppUserId,
      billingInterval: subscription.billingInterval,
      store: subscription.store,
      willRenew: subscription.willRenew,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      canceledAt: subscription.canceledAt,
    };
  }
}
