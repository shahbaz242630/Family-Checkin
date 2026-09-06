export interface CreateProviderWebhookEventInput {
  provider: string;
  eventType: string;
  providerEventId?: string;
  providerMessageId?: string;
  payload: Record<string, string | undefined>;
}

export interface ProviderWebhookEventKey {
  provider: string;
  eventType: string;
  providerEventId: string;
}

export interface CreateProviderWebhookEventIfAbsentResult {
  /** The stored event's id; absent only when the key was already claimed and its event row is no longer readable. */
  id?: string;
  created: boolean;
}

export interface ProviderWebhookEventsRepository {
  /** Looks up a stored event by its provider-side identity (used to short-circuit replays before processing). */
  findEvent(key: ProviderWebhookEventKey): Promise<{ id: string } | null>;
  /** Unconditional insert; use `createEventIfAbsent` for anything that carries a provider event id. */
  createEvent(input: CreateProviderWebhookEventInput): Promise<{ id: string }>;
  /**
   * Stores the event unless one with the same (provider, eventType, providerEventId) already exists, in which case
   * the existing id comes back with `created: false`. The natural key is unique at the database level
   * (`provider_webhook_event_keys`, CB-016), so two concurrent deliveries of one provider event store one row.
   * Events without a providerEventId are always stored.
   */
  createEventIfAbsent(input: CreateProviderWebhookEventInput): Promise<CreateProviderWebhookEventIfAbsentResult>;
}
