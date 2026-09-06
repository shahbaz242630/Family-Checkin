import { Inject, Injectable } from '@nestjs/common';
import { AbuseReportStatus } from '@prisma/client';
import type { AbuseReport } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ABUSE_REVIEW_PAUSE_REASON } from '../receivers/abuse-review-pause';
import type { AdminAbuseReportRecord, AdminAbuseReportsRepository } from './admin-abuse.repository';

type AbuseReportSafeRecord = Pick<
  AbuseReport,
  'id' | 'receiverId' | 'reportedAt' | 'reviewStatus' | 'reviewerAdminId' | 'reviewedAt' | 'reportContent'
>;

interface AdminAbusePrismaClient {
  abuseReport: {
    findMany(args: {
      where: {
        reviewStatus: AbuseReportStatus;
        receiver: { deletedAt: null };
      };
      select: typeof abuseReportSafeSelect;
      orderBy: { reportedAt: 'asc' };
      take: number;
    }): Promise<AbuseReportSafeRecord[]>;
    findFirst(args: {
      where: {
        id: string;
        receiver: { deletedAt: null };
      };
      select: typeof abuseReportSafeSelect;
    }): Promise<AbuseReportSafeRecord | null>;
    updateMany(args: {
      where: {
        id: string;
        reviewStatus: AbuseReportStatus;
        receiver: { deletedAt: null };
      };
      data: {
        reviewStatus: AbuseReportStatus;
        reviewerAdminId: string;
        reviewedAt: Date;
      };
    }): Promise<{ count: number }>;
  };
  receiver: {
    updateMany(args: {
      where: {
        id: string;
        deletedAt: null;
        pausedReason: string;
        abuseReports: { none: { reviewStatus: AbuseReportStatus } };
      };
      data: {
        pausedUntil: null;
        pausedReason: null;
      };
    }): Promise<{ count: number }>;
  };
}

const abuseReportSafeSelect = {
  id: true,
  receiverId: true,
  reportedAt: true,
  reviewStatus: true,
  reviewerAdminId: true,
  reviewedAt: true,
  reportContent: true,
} as const;

@Injectable()
export class PrismaAdminAbuseReportsRepository implements AdminAbuseReportsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: AdminAbusePrismaClient | PrismaService) {}

  async findPending(input: { limit: number }): Promise<AdminAbuseReportRecord[]> {
    const reports = await this.prisma.abuseReport.findMany({
      where: {
        reviewStatus: AbuseReportStatus.PENDING,
        receiver: { deletedAt: null },
      },
      select: abuseReportSafeSelect,
      orderBy: { reportedAt: 'asc' },
      take: input.limit,
    });

    return reports.map((report) => this.toRecord(report));
  }

  async findById(input: { abuseReportId: string }): Promise<AdminAbuseReportRecord | null> {
    const report = await this.prisma.abuseReport.findFirst({
      where: {
        id: input.abuseReportId,
        receiver: { deletedAt: null },
      },
      select: abuseReportSafeSelect,
    });

    return report ? this.toRecord(report) : null;
  }

  async reviewPending(input: {
    abuseReportId: string;
    reviewerAdminId: string;
    reviewStatus: Extract<AbuseReportStatus, 'REVIEWED_SAFE' | 'REVIEWED_ACTION_TAKEN'>;
    reviewedAt: Date;
  }): Promise<AdminAbuseReportRecord | null> {
    const result = await this.prisma.abuseReport.updateMany({
      where: {
        id: input.abuseReportId,
        reviewStatus: AbuseReportStatus.PENDING,
        receiver: { deletedAt: null },
      },
      data: {
        reviewStatus: input.reviewStatus,
        reviewerAdminId: input.reviewerAdminId,
        reviewedAt: input.reviewedAt,
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById({ abuseReportId: input.abuseReportId });
  }

  async clearAbuseReviewPause(input: { receiverId: string }): Promise<{ resumed: boolean }> {
    const result = await this.prisma.receiver.updateMany({
      where: {
        id: input.receiverId,
        deletedAt: null,
        pausedReason: ABUSE_REVIEW_PAUSE_REASON,
        abuseReports: { none: { reviewStatus: AbuseReportStatus.PENDING } },
      },
      data: {
        pausedUntil: null,
        pausedReason: null,
      },
    });

    return { resumed: result.count > 0 };
  }

  private toRecord(report: AbuseReportSafeRecord): AdminAbuseReportRecord {
    return {
      id: report.id,
      receiverId: report.receiverId,
      reportedAt: report.reportedAt,
      reviewStatus: report.reviewStatus,
      reviewerAdminId: report.reviewerAdminId ?? undefined,
      reviewedAt: report.reviewedAt ?? undefined,
      hasReportContent: Boolean(report.reportContent),
    };
  }
}
