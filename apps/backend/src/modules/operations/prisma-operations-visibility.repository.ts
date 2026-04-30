import { Inject, Injectable } from '@nestjs/common';
import { CheckInStatus, EscalationResult } from '@prisma/client';
import type { CheckIn, EscalationEvent } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  OperationsRecentCheckInRecord,
  OperationsStatusCountRecord,
  OperationsVisibilityRepository,
} from './operations-visibility.repository';

type RecentCheckIn = Pick<CheckIn, 'id' | 'receiverId' | 'status' | 'scheduledAt' | 'sentAt' | 'respondedAt' | 'resolvedAt'> & {
  escalations: Array<Pick<EscalationEvent, 'result'>>;
  _count: { escalations: number };
};

interface OperationsVisibilityPrismaClient {
  checkIn: {
    groupBy(args: {
      by: ['status'];
      where: {
        scheduledAt: { gte: Date };
        receiver: { deletedAt: null };
      };
      orderBy: { status: 'asc' };
      _count: { _all: true };
    }): Promise<Array<{ status: CheckInStatus; _count: { _all: number } }>>;
    findMany(args: {
      where: {
        status: { in: CheckInStatus[] };
        receiver: { deletedAt: null };
      };
      select: {
        id: true;
        receiverId: true;
        status: true;
        scheduledAt: true;
        sentAt: true;
        respondedAt: true;
        resolvedAt: true;
        escalations: {
          select: { result: true };
        };
        _count: {
          select: { escalations: true };
        };
      };
      orderBy: { scheduledAt: 'desc' };
      take: number;
    }): Promise<RecentCheckIn[]>;
  };
}

@Injectable()
export class PrismaOperationsVisibilityRepository implements OperationsVisibilityRepository {
  private static readonly operationalStatuses = [
    CheckInStatus.RESPONDED_HELP,
    CheckInStatus.ESCALATED,
    CheckInStatus.FAILED,
    CheckInStatus.SKIPPED,
    CheckInStatus.RESOLVED,
  ];

  constructor(@Inject(PrismaService) private readonly prisma: OperationsVisibilityPrismaClient | PrismaService) {}

  async countByStatusSince(input: { windowStart: Date }): Promise<OperationsStatusCountRecord[]> {
    const counts = await this.prisma.checkIn.groupBy({
      by: ['status'],
      where: {
        scheduledAt: { gte: input.windowStart },
        receiver: { deletedAt: null },
      },
      orderBy: { status: 'asc' },
      _count: { _all: true },
    });

    return counts.map((count) => ({
      status: count.status,
      count: (count._count as { _all: number })._all,
    }));
  }

  async findRecentOperationalCheckIns(input: { limit: number }): Promise<OperationsRecentCheckInRecord[]> {
    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        status: { in: [...PrismaOperationsVisibilityRepository.operationalStatuses] },
        receiver: { deletedAt: null },
      },
      select: {
        id: true,
        receiverId: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        respondedAt: true,
        resolvedAt: true,
        escalations: {
          select: { result: true },
        },
        _count: {
          select: { escalations: true },
        },
      },
      orderBy: { scheduledAt: 'desc' },
      take: input.limit,
    });

    return checkIns.map((checkIn) => ({
      checkInId: checkIn.id,
      receiverId: checkIn.receiverId,
      status: checkIn.status,
      scheduledAt: checkIn.scheduledAt,
      sentAt: checkIn.sentAt ?? undefined,
      respondedAt: checkIn.respondedAt ?? undefined,
      resolvedAt: checkIn.resolvedAt ?? undefined,
      escalationAttemptCount: checkIn._count.escalations,
      successfulEscalationCount: checkIn.escalations.filter((escalation) => escalation.result === EscalationResult.SUCCESS)
        .length,
    }));
  }
}
