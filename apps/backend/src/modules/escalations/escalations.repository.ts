import { CheckInStatus } from '@prisma/client';
import type { Channel, EscalationResult } from '@prisma/client';

export interface EscalationBackupContactRecord {
  id: string;
  receiverId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  /** Sender-written directions for reaching the receiver, read into backup alerts when present. */
  locationInstructionsEncrypted?: string;
  priorityOrder: number;
  createdAt: Date;
}

export interface EscalationReceiverOwnerRecord {
  userId: string;
  phoneEncrypted: string;
  /** Receiver's name and language, so backup alerts can say who and in which language. */
  receiverNameEncrypted?: string;
  receiverLanguage?: string;
}

export interface CreateEscalationEventInput {
  checkInId: string;
  attemptNumber: number;
  channel: Channel;
  startedAt: Date;
  completedAt?: Date;
  result?: EscalationResult;
  errorDetails?: string;
  senderNotifiedAt?: Date;
  backupAlertedAt?: Date;
}

export interface EscalationEventRecord extends CreateEscalationEventInput {
  id: string;
}

/**
 * Statuses a check-in may hold before an escalation writes it. A check-in the receiver already answered OK, or
 * that a backup contact resolved, must never be flipped back by a late escalation (CB-006).
 */
export const ESCALATION_CHECK_IN_ALLOWED_FROM = {
  escalated: [
    CheckInStatus.SENT,
    CheckInStatus.RESPONDED_HELP,
    CheckInStatus.NEEDS_ATTENTION,
    CheckInStatus.FAILED,
    CheckInStatus.SKIPPED,
  ],
  terminal: [CheckInStatus.PENDING, CheckInStatus.SENT, CheckInStatus.NEEDS_ATTENTION],
} satisfies Record<string, readonly CheckInStatus[]>;

export interface EscalationsRepository {
  findReceiverOwner(input: { receiverId: string }): Promise<EscalationReceiverOwnerRecord | null>;
  findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]>;
  /** Channels the check-in cascade already sent on, in attempt order; optional so lightweight fakes can omit it. */
  findChannelsTriedForCheckIn?(input: { checkInId: string }): Promise<Channel[]>;
  createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord>;
  /** An open or actionable status -> ESCALATED; a no-op once the check-in is answered OK or resolved. */
  markCheckInEscalated(input: { checkInId: string }): Promise<void>;
  /** PENDING, SENT or NEEDS_ATTENTION -> the given terminal status; a no-op once closed. */
  markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void>;
}
