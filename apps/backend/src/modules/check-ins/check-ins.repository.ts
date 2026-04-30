import type { Channel, CheckInStatus, ConsentStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface CheckInReceiverCandidate {
  id: string;
  phoneEncrypted: string;
  language: string;
  timezone: string;
  primaryChannel: Channel;
  scheduleFrequency: string;
  scheduleTimeWindow: Prisma.JsonObject;
  consentStatus: ConsentStatus;
  pausedUntil?: Date;
  deletedAt?: Date;
}

export interface CheckInRecord {
  id: string;
  receiverId: string;
  scheduledAt: Date;
  status: CheckInStatus;
  channelUsed?: Channel;
  sentAt?: Date;
  respondedAt?: Date;
  responseTranscript?: string;
  responseDetectedAs?: string;
  resolvedAt?: Date;
  resolutionNote?: string;
  resolutionByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingCheckInInput {
  receiverId: string;
  scheduledAt: Date;
}

export interface MarkCheckInSentInput {
  checkInId: string;
  channel: Channel;
  sentAt: Date;
  providerMessageId: string;
  providerStatus: string;
}

export interface MarkCheckInRespondedInput {
  checkInId: string;
  status: CheckInStatus;
  respondedAt: Date;
  responseDetectedAs: 'ok' | 'help';
  responseTranscript: string;
}

export interface ResolveCheckInByBackupContactInput {
  checkInId: string;
  resolvedAt: Date;
}

export interface FindOverdueSentCheckInsInput {
  overdueBefore: Date;
}

export interface CheckInsRepository {
  findReceiversDueForCheckIn(now: Date): Promise<CheckInReceiverCandidate[]>;
  createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord>;
  markSent(input: MarkCheckInSentInput): Promise<CheckInRecord>;
  findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  findLatestActionableForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord>;
  markResolvedByBackupContact(input: ResolveCheckInByBackupContactInput): Promise<CheckInRecord>;
  findOverdueSentCheckIns(input: FindOverdueSentCheckInsInput): Promise<CheckInRecord[]>;
}
