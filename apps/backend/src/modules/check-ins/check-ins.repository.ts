import type { Channel, CheckInAttemptStatus, CheckInStatus, ConsentStatus, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface CheckInReceiverCandidate {
  id: string;
  userId: string;
  phoneEncrypted: string;
  countryCode: string;
  language: string;
  timezone: string;
  techProfile: TechProfile;
  primaryChannel: Channel;
  fallbackChannels: Channel[];
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

export interface CheckInAttemptRecord {
  id: string;
  checkInId: string;
  attemptNumber: number;
  channel: Channel;
  status: CheckInAttemptStatus;
  scheduledAt: Date;
  sentAt?: Date;
  completedAt?: Date;
  providerMessageId?: string;
  providerStatus?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckInAttemptWithCheckInRecord extends CheckInAttemptRecord {
  checkIn: CheckInRecord & {
    receiverPhoneEncrypted: string;
    receiverCountryCode: string;
    receiverLanguage: string;
  };
}

export interface CreatePendingCheckInInput {
  receiverId: string;
  scheduledAt: Date;
}

export interface CreateCheckInAttemptInput {
  checkInId: string;
  attemptNumber: number;
  channel: Channel;
  scheduledAt: Date;
}

export interface MarkCheckInSentInput {
  checkInId: string;
  channel: Channel;
  sentAt: Date;
  providerMessageId: string;
  providerStatus: string;
}

export interface MarkCheckInAttemptSentInput {
  attemptId: string;
  sentAt: Date;
  providerMessageId: string;
  providerStatus: string;
}

export interface MarkCheckInAttemptFailedInput {
  attemptId: string;
  completedAt: Date;
  failureReason: string;
}

export interface MarkSentCheckInAttemptProviderFailureInput {
  providerMessageId: string;
  completedAt: Date;
  providerStatus: string;
  failureReason: string;
}

export interface MarkCheckInAttemptTimedOutInput {
  attemptId: string;
  completedAt: Date;
}

export interface SkipPendingCheckInAttemptsInput {
  checkInId: string;
  completedAt: Date;
  failureReason: string;
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
  createAttempts(input: CreateCheckInAttemptInput[]): Promise<CheckInAttemptRecord[]>;
  markSent(input: MarkCheckInSentInput): Promise<CheckInRecord>;
  findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  findTimedOutSentAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  markAttemptSent(input: MarkCheckInAttemptSentInput): Promise<CheckInAttemptRecord>;
  markAttemptFailed(input: MarkCheckInAttemptFailedInput): Promise<CheckInAttemptRecord>;
  markSentAttemptProviderFailure(
    input: MarkSentCheckInAttemptProviderFailureInput,
  ): Promise<CheckInAttemptRecord | null>;
  markAttemptTimedOut(input: MarkCheckInAttemptTimedOutInput): Promise<CheckInAttemptRecord>;
  markLatestSentAttemptResponded(input: { checkInId: string; completedAt: Date }): Promise<CheckInAttemptRecord | null>;
  skipPendingAttemptsForCheckIn(input: SkipPendingCheckInAttemptsInput): Promise<number>;
  markNeedsAttention(input: { checkInId: string }): Promise<CheckInRecord>;
  findById(checkInId: string): Promise<CheckInRecord | null>;
  findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  findLatestActionableForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord>;
  markResolvedByBackupContact(input: ResolveCheckInByBackupContactInput): Promise<CheckInRecord>;
  findOverdueSentCheckIns(input: FindOverdueSentCheckInsInput): Promise<CheckInRecord[]>;
}
