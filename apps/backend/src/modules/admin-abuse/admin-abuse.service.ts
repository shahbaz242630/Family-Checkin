import { Inject, Injectable, Optional } from '@nestjs/common';
import { AbuseReportStatus, ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AdminAbuseReportRecord, AdminAbuseReportsRepository } from './admin-abuse.repository';
import { ADMIN_ABUSE_REPORTS_REPOSITORY } from './admin-abuse.tokens';

const DEFAULT_PENDING_LIMIT = 50;

export interface AdminAbuseReportResponse {
  id: string;
  receiverId: string;
  reportedAt: string;
  reviewStatus: AbuseReportStatus;
  reviewerAdminId?: string;
  reviewedAt?: string;
  hasReportContent: boolean;
}

export interface AdminAbuseListResponse {
  ok: true;
  abuseReports: AdminAbuseReportResponse[];
}

export interface AdminAbuseDetailResponse {
  ok: true;
  abuseReport: AdminAbuseReportResponse;
}

@Injectable()
export class AdminAbuseService {
  constructor(
    @Inject(ADMIN_ABUSE_REPORTS_REPOSITORY)
    private readonly repository: AdminAbuseReportsRepository,
    @Inject(AuditService)
    private readonly auditService: Pick<AuditService, 'append'>,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async listPendingReports(): Promise<AdminAbuseListResponse> {
    const reports = await this.repository.findPending({ limit: DEFAULT_PENDING_LIMIT });

    return {
      ok: true,
      abuseReports: reports.map((report) => this.toResponse(report)),
    };
  }

  async getReport(abuseReportId: string): Promise<AdminAbuseDetailResponse | null> {
    const report = await this.repository.findById({ abuseReportId: abuseReportId.trim() });

    if (!report) {
      return null;
    }

    return {
      ok: true,
      abuseReport: this.toResponse(report),
    };
  }

  async markSafe(abuseReportId: string, input: { adminId: string }): Promise<AdminAbuseDetailResponse | null> {
    return this.review(abuseReportId, input, AbuseReportStatus.REVIEWED_SAFE, 'reviewed_safe');
  }

  async markActionTaken(abuseReportId: string, input: { adminId: string }): Promise<AdminAbuseDetailResponse | null> {
    return this.review(abuseReportId, input, AbuseReportStatus.REVIEWED_ACTION_TAKEN, 'reviewed_action_taken');
  }

  private async review(
    abuseReportId: string,
    input: { adminId: string },
    reviewStatus: Extract<AbuseReportStatus, 'REVIEWED_SAFE' | 'REVIEWED_ACTION_TAKEN'>,
    action: string,
  ): Promise<AdminAbuseDetailResponse | null> {
    const report = await this.repository.reviewPending({
      abuseReportId: abuseReportId.trim(),
      reviewerAdminId: input.adminId,
      reviewStatus,
      reviewedAt: this.now(),
    });

    if (!report) {
      return null;
    }

    // ACTION_TAKEN keeps the receiver paused; only a safe verdict lifts the abuse-review pause (CB-007).
    const receiverResumed =
      reviewStatus === AbuseReportStatus.REVIEWED_SAFE
        ? (await this.repository.clearAbuseReviewPause({ receiverId: report.receiverId })).resumed
        : false;

    await this.auditService.append({
      entityType: 'abuse_report',
      entityId: report.id,
      action,
      actorType: ActorType.ADMIN,
      actorId: input.adminId,
      metadata: {
        receiverId: report.receiverId,
        reviewStatus: report.reviewStatus,
        receiverResumed,
      },
    });

    return {
      ok: true,
      abuseReport: this.toResponse(report),
    };
  }

  private toResponse(report: AdminAbuseReportRecord): AdminAbuseReportResponse {
    return {
      id: report.id,
      receiverId: report.receiverId,
      reportedAt: report.reportedAt.toISOString(),
      reviewStatus: report.reviewStatus,
      reviewerAdminId: report.reviewerAdminId,
      reviewedAt: report.reviewedAt?.toISOString(),
      hasReportContent: report.hasReportContent,
    };
  }
}
