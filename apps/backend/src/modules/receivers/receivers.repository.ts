import type {
  AbuseReportStatus,
  Channel,
  CheckInStatus,
  ConsentStatus,
  EscalationResult,
  RelationshipType,
  TechProfile,
} from '@prisma/client';
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
  /** How many times the consent invitation was resent after the first one; drives the resend window (CB-081). */
  consentResendCount?: number;
  consentGrantedAt?: Date;
  consentRevokedAt?: Date;
  consentTranscript?: string;
  pausedUntil?: Date;
  pausedReason?: string;
  /** Set by the scheduler while the stored timezone or window cannot be evaluated; cleared once it can (CB-069). */
  scheduleInvalidAt?: Date;
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
  /** Encrypted; the sender's note or the backup contact's DONE text (CB-018). */
  resolutionNote?: string;
  resolutionByUserId?: string;
}

export interface ReceiverWithLatestCheckInRecord extends ReceiverRecord {
  latestCheckIn?: ReceiverLatestCheckInRecord;
  /**
   * The most recent time this receiver actually answered a check-in, across every check-in they ever had;
   * undefined when they never answered one. The latest check-in is not a substitute: a receiver who replied
   * yesterday has a PENDING check-in today, and "last heard from" must still read yesterday (CB-036).
   */
  lastHeardFrom?: Date;
}

/** One escalation attempt attached to a check-in in the sender's history view (CB-036). */
export interface ReceiverCheckInHistoryEscalationRecord {
  id: string;
  attemptNumber: number;
  channel: Channel;
  startedAt: Date;
  completedAt?: Date;
  result?: EscalationResult;
  senderNotifiedAt?: Date;
  backupAlertedAt?: Date;
}

export interface ReceiverCheckInHistoryRecord extends ReceiverLatestCheckInRecord {
  /**
   * The receiver's own calendar day for the check-in (`YYYY-MM-DD`), stored by the scheduler. It is what makes a
   * history row "one day for this receiver" rather than one UTC day.
   */
  scheduledLocalDate?: string;
  escalations: ReceiverCheckInHistoryEscalationRecord[];
}

export interface OptOutCooldownRecord {
  receiverId: string;
  optOutAt: Date;
  cooldownUntil: Date;
}

export interface ReceiversRepository {
  create(input: CreateReceiverRecordInput): Promise<ReceiverRecord>;
  findManyForUser(userId: string): Promise<ReceiverWithLatestCheckInRecord[]>;
  findForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null>;
  /**
   * The receiver's check-ins scheduled at or after `since`, newest first, each with its escalation events
   * (CB-036). Scoped by owner like every other receiver read, and capped by `limit` so a wide window cannot
   * turn into an unbounded read. Optional only so in-memory doubles in other modules keep compiling; a
   * repository without it yields an empty history.
   */
  findCheckInHistoryForUser?(input: {
    userId: string;
    receiverId: string;
    since: Date;
    limit: number;
  }): Promise<ReceiverCheckInHistoryRecord[]>;
  updateForUserById(input: UpdateReceiverRecordInput): Promise<ReceiverWithLatestCheckInRecord | null>;
  pauseForUserById(input: {
    userId: string;
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null>;
  resumeForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverWithLatestCheckInRecord | null>;
  deleteForUserById(input: {
    userId: string;
    receiverId: string;
    deletedAt: Date;
  }): Promise<ReceiverWithLatestCheckInRecord | null>;
  resolveCheckInForUserById(input: {
    userId: string;
    receiverId: string;
    checkInId: string;
    resolvedAt: Date;
    resolutionByUserId: string;
    /** Encrypted; omitted when the sender left no note (CB-018). */
    resolutionNote?: string;
  }): Promise<ReceiverWithLatestCheckInRecord | null>;
  /**
   * The non-deleted row an inbound reply from this phone belongs to: the one with the most recent open
   * check-in, else the most recently created (CB-014).
   */
  findActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord | null>;
  /** Every non-deleted row sharing the phone hash, newest first; consent replies fan out to all of them (CB-014). */
  findManyActiveByPhoneHash(phoneHash: string): Promise<ReceiverRecord[]>;
  /** Unscoped by sender; used to reach the owner after a backup contact's reply (CB-012). */
  findActiveById(receiverId: string): Promise<ReceiverRecord | null>;
  /** The latest cooldown for any row (deleted or not) that ever shared this phone hash (CB-009). */
  findOptOutCooldownByPhoneHash(phoneHash: string): Promise<OptOutCooldownRecord | null>;
  /** Overwrites `check_ins.resolutionNote` with an already-encrypted value (CB-018). */
  setCheckInResolutionNote(input: { checkInId: string; resolutionNote: string }): Promise<void>;
  markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
    /** True for a sender-triggered resend: bumps `consentResendCount` alongside the new request time (CB-081). */
    resend?: boolean;
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
