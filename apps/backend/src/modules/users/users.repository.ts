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

export interface UsersRepository {
  upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord>;
  /** The stored `displayNameEncrypted` of a live (not deleted) sender; null when unknown, deleted or unnamed. */
  findDisplayNameEncryptedById(userId: string): Promise<string | null>;
}
