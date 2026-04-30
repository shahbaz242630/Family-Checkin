import type { AbuseReportStatus, Channel, CheckInStatus, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
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

export interface UpdateReceiverRecordInput {
  userId: string;
  receiverId: string;
  nameEncrypted: string;
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
}

export interface ReceiverRecord extends CreateReceiverRecordInput {
  id: string;
  consentRequestedAt?: Date;
  consentGrantedAt?: Date;
  consentRevokedAt?: Date;
  consentTranscript?: string;
  pausedUntil?: Date;
  pausedReason?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceiverLatestCheckInRecord {
  id: string;
  status: CheckInStatus;
  scheduledAt: Date;
  channelUsed?: Channel;
  sentAt?: Date;
  respondedAt?: Date;
  responseDetectedAs?: string;
  resolvedAt?: Date;
  resolutionByUserId?: string;
}

export interface ReceiverWithLatestCheckInRecord extends ReceiverRecord {
  latestCheckIn?: ReceiverLatestCheckInRecord;
}

export interface ReceiversRepository {
  create(input: CreateReceiverRecordInput): Promise<ReceiverRecord>;
  findManyForUser(userId: string): Promise<ReceiverWithLatestCheckInRecord[]>;
  findForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null>;
  updateForUserById(input: UpdateReceiverRecordInput): Promise<ReceiverWithLatestCheckInRecord | null>;
  pauseForUserById(input: {
    userId: string;
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null>;
  resumeForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null>;
  deleteForUserById(input: { userId: string; receiverId: string; deletedAt: Date }): Promise<ReceiverWithLatestCheckInRecord | null>;
  resolveCheckInForUserById(input: {
    userId: string;
    receiverId: string;
    checkInId: string;
    resolvedAt: Date;
    resolutionByUserId: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null>;
  findActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord | null>;
  markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord>;
  updateConsentResponse(input: {
    receiverId: string;
    consentStatus: ConsentStatus;
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  }): Promise<ReceiverRecord>;
  upsertOptOutCooldown(input: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  }): Promise<void>;
  createAbuseReport(input: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }>;
  pauseForAbuseReview(input: { receiverId: string; pausedReason: string }): Promise<ReceiverRecord>;
}
