export interface CreateProviderWebhookEventInput {
  provider: string;
  eventType: string;
  providerEventId?: string;
  providerMessageId?: string;
  payload: Record<string, string | undefined>;
}

export interface ProviderWebhookEventsRepository {
  createEvent(input: CreateProviderWebhookEventInput): Promise<{ id: string }>;
  /**
   * Stores the event unless one with the same (provider, eventType, providerEventId) already exists, in which case
   * the existing id comes back with `created: false`. Events without a providerEventId are always stored.
   */
  createEventIfAbsent(input: CreateProviderWebhookEventInput): Promise<{ id: string; created: boolean }>;
}
