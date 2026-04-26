import type { Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface CreateReceiverRecordInput {
  userId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  phoneHash: string;
  countryCode: string;
  relationshipType: RelationshipType;
  language: string;
  timezone: string;
  techProfile: TechProfile;
  primaryChannel: Channel;
  fallbackChannels: Channel[];
  scheduleFrequency: string;
  scheduleTimeWindow: Prisma.InputJsonObject;
  scheduleCustomCron?: string;
  personalNoteEncrypted?: string;
  consentStatus: ConsentStatus;
}

export interface ReceiverRecord extends CreateReceiverRecordInput {
  id: string;
  consentRequestedAt?: Date;
  consentTranscript?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceiversRepository {
  create(input: CreateReceiverRecordInput): Promise<ReceiverRecord>;
  markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord>;
}
