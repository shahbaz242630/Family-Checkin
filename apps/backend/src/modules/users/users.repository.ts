export interface UpsertSenderRecordInput {
  authProviderId: string;
  emailEncrypted: string;
  emailHash: string;
  phoneEncrypted: string;
  phoneHash: string;
  /**
   * AES-256-GCM ciphertext of the sender's display name. Omitted when the identity carried no name, which leaves
   * a previously stored name untouched rather than wiping it on a token refresh without metadata (CB-010).
   */
  displayNameEncrypted?: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

export interface SenderRecord {
  id: string;
  authProviderId: string;
  emailEncrypted: string;
  emailHash: string;
  phoneEncrypted: string;
  phoneHash: string;
  displayNameEncrypted?: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

/**
 * Thrown by the write methods when a unique column (`authProviderId`, `emailHash`, `phoneHash`) already holds the
 * value: two first requests of the same sender raced, or the phone or email belongs to another account (CB-024).
 */
export class SenderUniqueConflictError extends Error {
  constructor(public readonly authProviderId: string) {
    super(`Sender ${authProviderId} conflicts with an existing users row`);
    this.name = 'SenderUniqueConflictError';
  }
}

export interface UsersRepository {
  /** The sender row for a Supabase user id, whatever its `deletedAt` (the upsert never filtered on it either); null when none. */
  findSenderByAuthProviderId(authProviderId: string): Promise<SenderRecord | null>;
  /** Insert only: the first request of a sender who has not called `POST /auth/sync-user` yet (CB-024). */
  createSender(input: UpsertSenderRecordInput): Promise<SenderRecord>;
  /** Insert or overwrite the profile columns; only `POST /auth/sync-user` may call this (CB-024). */
  upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord>;
  /** The stored `displayNameEncrypted` of a live (not deleted) sender; null when unknown, deleted or unnamed. */
  findDisplayNameEncryptedById(userId: string): Promise<string | null>;
}
