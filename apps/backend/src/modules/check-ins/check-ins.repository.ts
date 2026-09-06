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
  /**
   * The receiver's local schedule day (`YYYY-MM-DD`) the pending check-in belongs to, evaluated in the receiver's
   * own timezone by the repository. Stored on the check-in as the daily dedupe key with `id` (CB-013).
   */
  scheduledLocalDate: string;
}

export interface ScheduleInvalidReceiver {
  receiverId: string;
  /** The sender who owns the receiver, so the once-per-version quiet push has an addressee (CB-069). */
  userId: string;
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
  /**
   * Receivers stamped `scheduleInvalidAt` on an earlier tick whose schedule evaluates again (the sender fixed the
   * timezone or window). The service clears the stamp so a later bad value is audited afresh (CB-069). Optional
   * only so in-memory doubles in other modules keep compiling; `PrismaCheckInsRepository` always sets it.
   */
  recovered?: string[];
}

export interface CheckInRecord {
  id: string;
  receiverId: string;
  scheduledAt: Date;
  /**
   * `YYYY-MM-DD` in the receiver's timezone. The column is NOT NULL; the field is optional only so in-memory
   * test doubles in other modules need not know about it.
   */
  scheduledLocalDate?: string;
  /** The check-in this row retries (sender try-later); retry rows are outside the daily dedupe (CB-013). */
  retryOf?: string;
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
    /** Owner of the receiver, for the sender display name in retry copy (CB-010); optional only for doubles. */
    receiverUserId?: string;
  };
}

export interface CreatePendingCheckInInput {
  receiverId: string;
  scheduledAt: Date;
  /**
   * The receiver's local schedule day (`YYYY-MM-DD`; `localDateInTimeZone(scheduledAt, receiver.timezone)` or the
   * candidate's `scheduledLocalDate`). Defaults to the UTC calendar day of `scheduledAt` when omitted.
   */
  scheduledLocalDate?: string;
  /**
   * Set on a sender try-later row: the id of the check-in being retried. A row with `retryOf` never takes part in
   * the once-per-local-day dedupe and is exempt from its unique index (CB-013).
   */
  retryOf?: string;
}

/**
 * Thrown by `createPending` when the receiver already has a non-retry check-in for that local day: the partial
 * unique index on `(receiverId, scheduledLocalDate)` rejected the insert, which means an overlapping tick (or a
 * caller that forgot `retryOf`) got there first. The service counts it as skipped and moves on (CB-013).
 */
export class CheckInAlreadyScheduledError extends Error {
  constructor(
    public readonly receiverId: string,
    public readonly scheduledLocalDate: string,
  ) {
    super(`Receiver ${receiverId} already has a check-in for ${scheduledLocalDate}`);
    this.name = 'CheckInAlreadyScheduledError';
  }
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
  /**
   * Absent when the cron claims the attempt before the provider call (CB-045): the provider's id arrives afterwards
   * through `recordAttemptSendResult`. Present when the caller already holds the provider's answer.
   */
  providerMessageId?: string;
  providerStatus: string;
}

/** The provider's answer for an attempt the cron claimed with `markAttemptSent` before sending (CB-045). */
export interface RecordCheckInAttemptSendResultInput {
  attemptId: string;
  providerMessageId: string;
  providerStatus: string;
}

/** What `runExclusively` resolves to: the work's result, or `locked` when another tick held the lock. */
export type ExclusiveRunResult<T> = { locked: true } | { locked: false; result: T };

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
  /**
   * Stamps `Receiver.scheduleInvalidAt` when it is still null; `true` only when this call set it, so the caller
   * audits a bad schedule once per version instead of once per tick (CB-069). Optional, like `recovered`, only for
   * doubles in other modules: a repository without it is audited on every tick, the pre-CB-069 behaviour.
   */
  markScheduleInvalid?(input: { receiverId: string; seenAt: Date }): Promise<boolean>;
  /** Clears `Receiver.scheduleInvalidAt` for the given receivers; returns how many were still stamped. */
  clearScheduleInvalid?(input: { receiverIds: string[] }): Promise<number>;
  /** Throws `CheckInAlreadyScheduledError` when a non-retry check-in for that receiver and local day exists. */
  createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord>;
  createAttempts(input: CreateCheckInAttemptInput[]): Promise<CheckInAttemptRecord[]>;
  /** PENDING or SENT -> SENT. */
  markSent(input: MarkCheckInSentInput): Promise<boolean>;
  findDuePendingAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  findTimedOutSentAttempts(input: { now: Date }): Promise<CheckInAttemptWithCheckInRecord[]>;
  /**
   * PENDING -> SENT. The cron calls it *before* the provider call, as the atomic claim on the attempt (CB-045):
   * `false` means another tick claimed it first and this one must not send it. The provider's id is stored
   * afterwards through `recordAttemptSendResult`.
   */
  markAttemptSent(input: MarkCheckInAttemptSentInput): Promise<boolean>;
  /**
   * Stores the provider's message or call id and status on an attempt claimed by `markAttemptSent`, only while it
   * is still SENT. Optional only for doubles in other modules; `PrismaCheckInsRepository` always provides it.
   */
  recordAttemptSendResult?(input: RecordCheckInAttemptSendResultInput): Promise<boolean>;
  /** How many attempts of the check-in are still PENDING, counted in the database (CB-045). Optional only for doubles. */
  countPendingAttempts?(input: { checkInId: string }): Promise<number>;
  /** The earliest PENDING attempt of the check-in that is already due (`scheduledAt <= now`), or null. Optional only for doubles. */
  findNextDuePendingAttempt?(input: { checkInId: string; now: Date }): Promise<CheckInAttemptWithCheckInRecord | null>;
  /**
   * Runs `work` while holding the scheduler's Postgres advisory lock so two overlapping ticks never process the
   * same rows; resolves `{ locked: true }` at once, without running `work`, when another tick holds it (CB-045).
   * The work runs on the normal client: the lock's transaction does nothing but hold the lock, and must outlive
   * the run (`timeoutMs`). Optional only for doubles in other modules.
   */
  runExclusively?<T>(work: () => Promise<T>, options: { timeoutMs: number }): Promise<ExclusiveRunResult<T>>;
  /** PENDING or SENT -> FAILED. */
  markAttemptFailed(input: MarkCheckInAttemptFailedInput): Promise<boolean>;
  /** The latest SENT attempt for the provider id -> FAILED; null when no such attempt is still SENT. */
  markSentAttemptProviderFailure(
    input: MarkSentCheckInAttemptProviderFailureInput,
  ): Promise<CheckInAttemptRecord | null>;
  /** SENT -> TIMED_OUT. */
  markAttemptTimedOut(input: MarkCheckInAttemptTimedOutInput): Promise<boolean>;
  /**
   * Moves the earliest PENDING attempt of the check-in to `dueAt` when it is scheduled later, so the next tick
   * sends it instead of waiting out the stagger after a provider reported the current one undelivered (CB-016).
   * `true` only when an attempt was moved. Optional, like the schedule stamp, only for doubles in other modules.
   */
  expediteNextPendingAttempt?(input: { checkInId: string; dueAt: Date }): Promise<boolean>;
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
