/** Body of `POST /billing/revenuecat/webhook` (CB-042). */
import { z } from 'zod';
import { MAX_ID_LENGTH } from './primitives';

const revenueCatIdSchema = z.string().max(MAX_ID_LENGTH);

/**
 * Shape only. Which fields an event must carry stays with `BillingController.parseRevenueCatEvent`, which
 * answers 400 `RevenueCat webhook payload is invalid` — a store that adds a field to an event we already accept
 * must not start failing here (the request is authenticated by the RevenueCat bearer token, CB-026).
 */
export const revenueCatWebhookBodySchema = z.object({
  api_version: z.string().max(MAX_ID_LENGTH).optional(),
  event: z
    .object({
      type: revenueCatIdSchema.optional(),
      id: revenueCatIdSchema.optional(),
      app_user_id: revenueCatIdSchema.optional(),
      product_id: revenueCatIdSchema.optional(),
      entitlement_ids: z.array(revenueCatIdSchema).max(100).optional(),
      store: revenueCatIdSchema.optional(),
      purchased_at_ms: z.number().optional(),
      expiration_at_ms: z.number().nullable().optional(),
      period_type: z.string().max(MAX_ID_LENGTH).nullable().optional(),
      transaction_id: revenueCatIdSchema.optional(),
    })
    .optional(),
});

export type RevenueCatWebhookBody = z.infer<typeof revenueCatWebhookBodySchema>;
