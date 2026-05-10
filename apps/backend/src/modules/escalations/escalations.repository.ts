import type { Channel, CheckInStatus, EscalationResult } from '@prisma/client';

export interface EscalationBackupContactRecord {
  id: string;
  receiverId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  priorityOrder: number;
  createdAt: Date;
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
  findReceiverOwner(input: { receiverId: string }): Promise<{ userId: string } | null>;
  findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]>;
  createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord>;
  markCheckInEscalated(input: { checkInId: string }): Promise<void>;
  markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void>;
}
