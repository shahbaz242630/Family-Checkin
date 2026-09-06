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

export interface ProviderWebhookEventsRepository {
  /** Looks up a stored event by its provider-side identity (used to short-circuit replays before processing). */
  findEvent(key: ProviderWebhookEventKey): Promise<{ id: string } | null>;
  createEvent(input: CreateProviderWebhookEventInput): Promise<{ id: string }>;
  /**
   * Stores the event unless one with the same (provider, eventType, providerEventId) already exists, in which case
   * the existing id comes back with `created: false`. Events without a providerEventId are always stored.
   */
  createEventIfAbsent(input: CreateProviderWebhookEventInput): Promise<{ id: string; created: boolean }>;
}
