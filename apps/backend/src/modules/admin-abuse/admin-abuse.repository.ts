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
  /**
   * Lifts the abuse-review pause on a receiver once no PENDING report remains for it. Only a pause carrying the
   * abuse-review reason is cleared, so a sender's own pause survives. `resumed` is false when nothing changed.
   */
  clearAbuseReviewPause(input: { receiverId: string }): Promise<{ resumed: boolean }>;
}
