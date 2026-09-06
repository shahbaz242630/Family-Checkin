import type { Channel, CheckInStatus, EscalationResult } from '@prisma/client';

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

export interface EscalationsRepository {
  findReceiverOwner(input: { receiverId: string }): Promise<EscalationReceiverOwnerRecord | null>;
  findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]>;
  /** Channels the check-in cascade already sent on, in attempt order; optional so lightweight fakes can omit it. */
  findChannelsTriedForCheckIn?(input: { checkInId: string }): Promise<Channel[]>;
  createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord>;
  markCheckInEscalated(input: { checkInId: string }): Promise<void>;
  markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void>;
}
