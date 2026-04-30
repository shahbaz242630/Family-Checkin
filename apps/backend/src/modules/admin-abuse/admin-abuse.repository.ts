import type { AbuseReportStatus } from '@prisma/client';

export interface AdminAbuseReportRecord {
  id: string;
  receiverId: string;
  reportedAt: Date;
  reviewStatus: AbuseReportStatus;
  reviewerAdminId?: string;
  reviewedAt?: Date;
  hasReportContent: boolean;
}

export interface AdminAbuseReportsRepository {
  findPending(input: { limit: number }): Promise<AdminAbuseReportRecord[]>;
  findById(input: { abuseReportId: string }): Promise<AdminAbuseReportRecord | null>;
  reviewPending(input: {
    abuseReportId: string;
    reviewerAdminId: string;
    reviewStatus: Extract<AbuseReportStatus, 'REVIEWED_SAFE' | 'REVIEWED_ACTION_TAKEN'>;
    reviewedAt: Date;
  }): Promise<AdminAbuseReportRecord | null>;
}
