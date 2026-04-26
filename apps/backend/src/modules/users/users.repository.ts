export interface UpsertSenderRecordInput {
  authProviderId: string;
  emailEncrypted: string;
  emailHash: string;
  phoneEncrypted: string;
  phoneHash: string;
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
  country: string;
  preferredLanguage: string;
  timezone: string;
}

export interface UsersRepository {
  upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord>;
}
