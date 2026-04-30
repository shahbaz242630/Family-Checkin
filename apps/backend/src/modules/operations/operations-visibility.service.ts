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
}
