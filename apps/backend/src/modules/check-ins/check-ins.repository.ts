import { CheckInAttemptStatus, CheckInStatus } from '@prisma/client';
import type { Channel, ConsentStatus, TechProfile } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface CheckInReceiverCandidate {
  id: string;
  userId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  personalNoteEncrypted?: string;
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

export interface ScheduleInvalidReceiver {
  receiverId: string;
  /** Lower-case validation code such as `invalid_timezone`; safe to put in audit metadata. */
  reason: string;
}

export interface ReceiversDueForCheckIn {
  candidates: CheckInReceiverCandidate[];
  /**
   * Rows whose timezone or schedule window could not be evaluated. They are never candidates; the service
   * audits each one so a bad row is visible instead of silently stalling every receiver (CB-004).
   */
  skipped: ScheduleInvalidReceiver[];
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
    receiverNameEncrypted?: string;
    receiverPersonalNoteEncrypted?: string;
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

/**
 * Statuses a check-in may hold immediately before each transition. Every status write is conditional on one of
 * these (`updateMany` with `status: { in }`), so a late provider callback or fallback attempt can never reopen or
 * downgrade a check-in that a reply, a backup contact or a cancellation already closed (CB-006).
 */
export const CHECK_IN_ALLOWED_FROM = {
  sent: [CheckInStatus.PENDING, CheckInStatus.SENT],
  needsAttention: [CheckInStatus.PENDING, CheckInStatus.SENT],
  cancelled: [CheckInStatus.PENDING, CheckInStatus.SENT],
  responded: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION],
  resolvedByBackupContact: [
    CheckInStatus.RESPONDED_HELP,
    CheckInStatus.ESCALATED,
    CheckInStatus.NEEDS_ATTENTION,
    CheckInStatus.FAILED,
    CheckInStatus.SKIPPED,
  ],
} satisfies Record<string, readonly CheckInStatus[]>;

/** Same idea for attempts: an attempt only moves forward from the status its writer expects. */
export const CHECK_IN_ATTEMPT_ALLOWED_FROM = {
  sent: [CheckInAttemptStatus.PENDING],
  failed: [CheckInAttemptStatus.PENDING, CheckInAttemptStatus.SENT],
  providerFailure: [CheckInAttemptStatus.SENT],
  timedOut: [CheckInAttemptStatus.SENT],
  responded: [CheckInAttemptStatus.SENT],
  skipped: [CheckInAttemptStatus.PENDING],
} satisfies Record<string, readonly CheckInAttemptStatus[]>;

/** Statuses in which a check-in is still waiting on the receiver and can be cancelled (CB-008). */
export const OPEN_CHECK_IN_STATUSES: readonly CheckInStatus[] = [CheckInStatus.PENDING, CheckInStatus.SENT];

/**
 * Transition methods return `true` when the row was in an allowed status and moved, `false` when nothing was
 * written; callers treat `false` as "someone else closed this first" and do not audit or notify.
 */
export interface CheckInsRepository {
  findReceiversDueForCheckIn(now: Date): Promise<ReceiversDueForCheckIn>;
  createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord>;
  createAttempts(input: CreateCheckInAttemptInput[]): Promise<CheckInAttemptRecord[]>;
  /** PENDING or SENT -> SENT. */
  markSent(input: MarkCheckInSentInput): Promise<boolean>;
  findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  findTimedOutSentAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  /** PENDING -> SENT. */
  markAttemptSent(input: MarkCheckInAttemptSentInput): Promise<boolean>;
  /** PENDING or SENT -> FAILED. */
  markAttemptFailed(input: MarkCheckInAttemptFailedInput): Promise<boolean>;
  /** The latest SENT attempt for the provider id -> FAILED; null when no such attempt is still SENT. */
  markSentAttemptProviderFailure(
    input: MarkSentCheckInAttemptProviderFailureInput,
  ): Promise<CheckInAttemptRecord | null>;
  /** SENT -> TIMED_OUT. */
  markAttemptTimedOut(input: MarkCheckInAttemptTimedOutInput): Promise<boolean>;
  /** The latest SENT attempt of the check-in -> RESPONDED; null when none is SENT. */
  markLatestSentAttemptResponded(input: { checkInId: string; completedAt: Date }): Promise<CheckInAttemptRecord | null>;
  /** Every PENDING attempt of the check-in -> SKIPPED; returns how many moved. */
  skipPendingAttemptsForCheckIn(input: SkipPendingCheckInAttemptsInput): Promise<number>;
  /** PENDING or SENT -> NEEDS_ATTENTION. `false` once already flagged or closed, so the sender is told once (CB-005). */
  markNeedsAttention(input: { checkInId: string }): Promise<boolean>;
  /** PENDING or SENT -> SKIPPED when the receiver opts out, is reported, paused or deleted (CB-008). */
  markCancelled(input: { checkInId: string }): Promise<boolean>;
  findById(checkInId: string): Promise<CheckInRecord | null>;
  /** Every check-in of the receiver still in an `OPEN_CHECK_IN_STATUSES` status, oldest first. */
  findOpenForReceiver(receiverId: string): Promise<CheckInRecord[]>;
  findLatestOpenForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  findLatestActionableForReceiver(receiverId: string): Promise<CheckInRecord | null>;
  /** PENDING, SENT or NEEDS_ATTENTION -> RESPONDED_*; null when the check-in closed first. */
  markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord | null>;
  /** An actionable status -> RESOLVED; null when the check-in is no longer actionable. */
  markResolvedByBackupContact(input: ResolveCheckInByBackupContactInput): Promise<CheckInRecord | null>;
}
