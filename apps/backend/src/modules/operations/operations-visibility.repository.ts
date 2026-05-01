import type { Channel, CheckInAttemptStatus, CheckInStatus, EscalationResult } from '@prisma/client';

export interface OperationsStatusCountRecord {
  status: CheckInStatus;
  count: number;
}

export interface OperationsRecentCheckInRecord {
  checkInId: string;
  receiverId: string;
  status: CheckInStatus;
  scheduledAt: Date;
  sentAt?: Date;
  respondedAt?: Date;
  resolvedAt?: Date;
  escalationAttemptCount: number;
  successfulEscalationCount: number;
}

export interface OperationsEscalationDetailRecord {
  id: string;
  attemptNumber: number;
  channel: Channel;
  startedAt: Date;
  completedAt?: Date;
  result?: EscalationResult;
  senderNotifiedAt?: Date;
  backupAlertedAt?: Date;
}

export interface OperationsCheckInAttemptDetailRecord {
  id: string;
  attemptNumber: number;
  channel: Channel;
  status: CheckInAttemptStatus;
  scheduledAt: Date;
  sentAt?: Date;
  completedAt?: Date;
  providerStatus?: string;
  failureReason?: string;
}

export interface OperationsCheckInDetailRecord {
  checkInId: string;
  receiverId: string;
  status: CheckInStatus;
  channelUsed?: Channel;
  scheduledAt: Date;
  sentAt?: Date;
  respondedAt?: Date;
  responseDetectedAs?: string;
  resolvedAt?: Date;
  escalationAttemptCount: number;
  successfulEscalationCount: number;
  attempts: OperationsCheckInAttemptDetailRecord[];
  escalations: OperationsEscalationDetailRecord[];
}

export interface OperationsVisibilityRepository {
  countByStatusSince(input: { windowStart: Date }): Promise<OperationsStatusCountRecord[]>;
  findRecentOperationalCheckIns(input: { limit: number }): Promise<OperationsRecentCheckInRecord[]>;
  findOperationalCheckInDetail(input: { checkInId: string }): Promise<OperationsCheckInDetailRecord | null>;
}
