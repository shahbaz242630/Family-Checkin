import type { CheckInStatus } from '@prisma/client';

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

export interface OperationsVisibilityRepository {
  countByStatusSince(input: { windowStart: Date }): Promise<OperationsStatusCountRecord[]>;
  findRecentOperationalCheckIns(input: { limit: number }): Promise<OperationsRecentCheckInRecord[]>;
}
