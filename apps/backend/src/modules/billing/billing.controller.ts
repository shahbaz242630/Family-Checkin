import { Body, Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { BillingStore } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import type { SenderRecord } from '../users/users.repository';
import { BillingService, type RevenueCatWebhookEvent } from './billing.service';

interface RevenueCatWebhookBody {
  event?: {
    type?: string;
    id?: string;
    app_user_id?: string;
    product_id?: string;
    entitlement_ids?: string[];
    store?: string;
    purchased_at_ms?: number;
    expiration_at_ms?: number | null;
    period_type?: string | null;
    transaction_id?: string;
  };
}

@Controller('billing')
export class BillingController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: Pick<SupabaseAuthService, 'verifyAccessToken'>,
    @Inject(UsersService)
    private readonly usersService: Pick<UsersService, 'upsertFromSupabaseIdentity'>,
    @Inject(BillingService)
    private readonly billingService: BillingService,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'revenueCatWebhookAuthToken'>,
  ) {}

  @Get('status')
  async getBillingStatus(@Headers('authorization') authorization: string | undefined) {
    const sender = await this.authenticateSender(authorization);
    return this.billingService.getBillingStatus(sender.id);
  }

  @Post('revenuecat/webhook')
  async handleRevenueCatWebhook(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-revenuecat-authorization') revenueCatAuthorization: string | undefined,
    @Body() body: RevenueCatWebhookBody,
  ) {
    this.assertRevenueCatAuth(authorization ?? revenueCatAuthorization);
    const event = this.parseRevenueCatEvent(body);
    return this.billingService.syncRevenueCatEvent(event);
  }

  private async authenticateSender(authorization: string | undefined): Promise<SenderRecord> {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    return this.usersService.upsertFromSupabaseIdentity(identity);
  }

  private assertRevenueCatAuth(authorization: string | undefined): void {
    const expected = this.config.revenueCatWebhookAuthToken;
    const provided = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : authorization;
    if (!expected || !provided || provided !== expected) {
      throw new UnauthorizedException('RevenueCat webhook authorization is required');
    }
  }

  private parseRevenueCatEvent(body: RevenueCatWebhookBody): RevenueCatWebhookEvent {
    const event = body.event;
    if (
      !event?.type ||
      !event.id ||
      !event.app_user_id ||
      !event.product_id ||
      !event.transaction_id ||
      !event.purchased_at_ms
    ) {
      throw new UnauthorizedException('RevenueCat webhook payload is invalid');
    }

    return {
      type: event.type,
      eventId: event.id,
      appUserId: event.app_user_id,
      productId: event.product_id,
      entitlementIds: event.entitlement_ids ?? [],
      store: this.parseStore(event.store),
      purchasedAt: new Date(event.purchased_at_ms),
      expirationAt: event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
      periodType: event.period_type ?? null,
      transactionId: event.transaction_id,
    };
  }

  private parseStore(store: string | undefined): BillingStore {
    switch (store) {
      case 'APP_STORE':
        return BillingStore.APP_STORE;
      case 'PLAY_STORE':
        return BillingStore.PLAY_STORE;
      case 'STRIPE':
        return BillingStore.STRIPE;
      case 'PROMOTIONAL':
        return BillingStore.PROMOTIONAL;
      default:
        return BillingStore.UNKNOWN;
    }
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    return token;
  }
}
