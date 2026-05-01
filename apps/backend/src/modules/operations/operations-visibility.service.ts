import { Inject, Injectable } from '@nestjs/common';
import type { CheckInStatus } from '@prisma/client';
import type { OperationsVisibilityRepository } from './operations-visibility.repository';
import { OPERATIONS_VISIBILITY_REPOSITORY } from './operations.tokens';

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_RECENT_LIMIT = 25;

export interface OperationsCheckInSummary {
  ok: true;
  windowHours: number;
  generatedAt: string;
  statusCounts: Partial<Record<CheckInStatus, number>>;
  recent: Array<{
    checkInId: string;
    receiverId: string;
    status: CheckInStatus;
    scheduledAt: string;
    sentAt?: string;
    respondedAt?: string;
    resolvedAt?: string;
    escalationAttemptCount: number;
    successfulEscalationCount: number;
  }>;
}

export interface OperationsCheckInDetail {
  ok: true;
  checkIn: {
    checkInId: string;
    receiverId: string;
    status: CheckInStatus;
    channelUsed?: string;
    scheduledAt: string;
    sentAt?: string;
    respondedAt?: string;
    responseDetectedAs?: string;
    resolvedAt?: string;
    escalationAttemptCount: number;
    successfulEscalationCount: number;
    attempts: Array<{
      id: string;
      attemptNumber: number;
      channel: string;
      status: string;
      scheduledAt: string;
      sentAt?: string;
      completedAt?: string;
      providerStatus?: string;
      failureReason?: string;
    }>;
    escalations: Array<{
      id: string;
      attemptNumber: number;
      channel: string;
      startedAt: string;
      completedAt?: string;
      result?: string;
      senderNotifiedAt?: string;
      backupAlertedAt?: string;
    }>;
  };
}

@Injectable()
export class OperationsVisibilityService {
  constructor(
    @Inject(OPERATIONS_VISIBILITY_REPOSITORY)
    private readonly repository: OperationsVisibilityRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getCheckInSummary(): Promise<OperationsCheckInSummary> {
    const generatedAt = this.now();
    const windowStart = new Date(generatedAt.getTime() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
    const [counts, recent] = await Promise.all([
      this.repository.countByStatusSince({ windowStart }),
      this.repository.findRecentOperationalCheckIns({ limit: DEFAULT_RECENT_LIMIT }),
    ]);

    return {
      ok: true,
      windowHours: DEFAULT_WINDOW_HOURS,
      generatedAt: generatedAt.toISOString(),
      statusCounts: Object.fromEntries(counts.map((count) => [count.status, count.count])) as Partial<
        Record<CheckInStatus, number>
      >,
      recent: recent.map((checkIn) => ({
        checkInId: checkIn.checkInId,
        receiverId: checkIn.receiverId,
        status: checkIn.status,
        scheduledAt: checkIn.scheduledAt.toISOString(),
        sentAt: checkIn.sentAt?.toISOString(),
        respondedAt: checkIn.respondedAt?.toISOString(),
        resolvedAt: checkIn.resolvedAt?.toISOString(),
        escalationAttemptCount: checkIn.escalationAttemptCount,
        successfulEscalationCount: checkIn.successfulEscalationCount,
      })),
    };
  }

  async getCheckInDetail(checkInId: string): Promise<OperationsCheckInDetail | null> {
    const checkIn = await this.repository.findOperationalCheckInDetail({ checkInId: checkInId.trim() });

    if (!checkIn) {
      return null;
    }

    return {
      ok: true,
      checkIn: {
        checkInId: checkIn.checkInId,
        receiverId: checkIn.receiverId,
        status: checkIn.status,
        channelUsed: checkIn.channelUsed,
        scheduledAt: checkIn.scheduledAt.toISOString(),
        sentAt: checkIn.sentAt?.toISOString(),
        respondedAt: checkIn.respondedAt?.toISOString(),
        responseDetectedAs: checkIn.responseDetectedAs,
        resolvedAt: checkIn.resolvedAt?.toISOString(),
        escalationAttemptCount: checkIn.escalationAttemptCount,
        successfulEscalationCount: checkIn.successfulEscalationCount,
        attempts: (checkIn.attempts ?? []).map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          channel: attempt.channel,
          status: attempt.status,
          scheduledAt: attempt.scheduledAt.toISOString(),
          sentAt: attempt.sentAt?.toISOString(),
          completedAt: attempt.completedAt?.toISOString(),
          providerStatus: attempt.providerStatus,
          failureReason: attempt.failureReason,
        })),
        escalations: checkIn.escalations.map((escalation) => ({
          id: escalation.id,
          attemptNumber: escalation.attemptNumber,
          channel: escalation.channel,
          startedAt: escalation.startedAt.toISOString(),
          completedAt: escalation.completedAt?.toISOString(),
          result: escalation.result,
          senderNotifiedAt: escalation.senderNotifiedAt?.toISOString(),
          backupAlertedAt: escalation.backupAlertedAt?.toISOString(),
        })),
      },
    };
  }
}
