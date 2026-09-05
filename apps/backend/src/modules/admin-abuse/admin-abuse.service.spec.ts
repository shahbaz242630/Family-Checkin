import { AbuseReportStatus, ActorType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { AdminAbuseReportRecord, AdminAbuseReportsRepository } from './admin-abuse.repository';
import { AdminAbuseService } from './admin-abuse.service';

class FakeAdminAbuseReportsRepository implements AdminAbuseReportsRepository {
  public calls: unknown[] = [];
  public clearPauseResult = { resumed: true };

  async findPending(input: { limit: number }) {
    this.calls.push({ method: 'findPending', input });
    return [abuseReportRecord({ id: 'abuse-report-1' })];
  }

  async findById(input: { abuseReportId: string }) {
    this.calls.push({ method: 'findById', input });

    if (input.abuseReportId === 'missing-report') {
      return null;
    }

    return abuseReportRecord({ id: input.abuseReportId });
  }

  async reviewPending(input: {
    abuseReportId: string;
    reviewerAdminId: string;
    reviewStatus: 'REVIEWED_SAFE' | 'REVIEWED_ACTION_TAKEN';
    reviewedAt: Date;
  }) {
    this.calls.push({ method: 'reviewPending', input });

    if (input.abuseReportId === 'missing-report') {
      return null;
    }

    return abuseReportRecord({
      id: input.abuseReportId,
      reviewStatus: input.reviewStatus,
      reviewerAdminId: input.reviewerAdminId,
      reviewedAt: input.reviewedAt,
    });
  }

  async clearAbuseReviewPause(input: { receiverId: string }) {
    this.calls.push({ method: 'clearAbuseReviewPause', input });
    return this.clearPauseResult;
  }
}

class FakeAuditService {
  public calls: unknown[] = [];

  async append(input: unknown) {
    this.calls.push(input);
    return input;
  }
}

describe('AdminAbuseService', () => {
  it('returns a PII-safe pending abuse queue', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const service = new AdminAbuseService(repository, new FakeAuditService() as unknown as AuditService);

    const response = await service.listPendingReports();

    expect(repository.calls).toEqual([{ method: 'findPending', input: { limit: 50 } }]);
    expect(response).toEqual({
      ok: true,
      abuseReports: [
        {
          id: 'abuse-report-1',
          receiverId: 'receiver-1',
          reportedAt: '2026-04-30T07:00:00.000Z',
          reviewStatus: AbuseReportStatus.PENDING,
          reviewerAdminId: undefined,
          reviewedAt: undefined,
          hasReportContent: true,
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('phone');
    expect(JSON.stringify(response)).not.toContain('name');
    expect(JSON.stringify(response)).not.toContain('reportContent');
    expect(JSON.stringify(response)).not.toContain('reporter');
  });

  it('returns one PII-safe abuse report detail', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const service = new AdminAbuseService(repository, new FakeAuditService() as unknown as AuditService);

    const response = await service.getReport(' abuse-report-1 ');

    expect(repository.calls).toEqual([{ method: 'findById', input: { abuseReportId: 'abuse-report-1' } }]);
    expect(response).toEqual({
      ok: true,
      abuseReport: {
        id: 'abuse-report-1',
        receiverId: 'receiver-1',
        reportedAt: '2026-04-30T07:00:00.000Z',
        reviewStatus: AbuseReportStatus.PENDING,
        reviewerAdminId: undefined,
        reviewedAt: undefined,
        hasReportContent: true,
      },
    });
  });

  it('returns null when the abuse report does not exist', async () => {
    const service = new AdminAbuseService(
      new FakeAdminAbuseReportsRepository(),
      new FakeAuditService() as unknown as AuditService,
    );

    await expect(service.getReport('missing-report')).resolves.toBeNull();
  });

  it('marks a pending abuse report safe and appends a PII-safe admin audit event', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const audit = new FakeAuditService();
    const service = new AdminAbuseService(
      repository,
      audit as unknown as AuditService,
      () => new Date('2026-04-30T08:00:00.000Z'),
    );

    const response = await service.markSafe('abuse-report-1', { adminId: 'admin-1' });

    expect(repository.calls).toEqual([
      {
        method: 'reviewPending',
        input: {
          abuseReportId: 'abuse-report-1',
          reviewerAdminId: 'admin-1',
          reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
          reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
        },
      },
      {
        method: 'clearAbuseReviewPause',
        input: { receiverId: 'receiver-1' },
      },
    ]);
    expect(audit.calls).toEqual([
      {
        entityType: 'abuse_report',
        entityId: 'abuse-report-1',
        action: 'reviewed_safe',
        actorType: ActorType.ADMIN,
        actorId: 'admin-1',
        metadata: {
          receiverId: 'receiver-1',
          reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
          receiverResumed: true,
        },
      },
    ]);
    expect(response?.abuseReport.reviewStatus).toBe(AbuseReportStatus.REVIEWED_SAFE);
    expect(JSON.stringify(audit.calls)).not.toContain('phone');
    expect(JSON.stringify(audit.calls)).not.toContain('name');
    expect(JSON.stringify(audit.calls)).not.toContain('content');
    expect(JSON.stringify(audit.calls)).not.toContain('reporter');
  });

  it('marks a pending abuse report action taken and appends a PII-safe admin audit event', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const audit = new FakeAuditService();
    const service = new AdminAbuseService(
      repository,
      audit as unknown as AuditService,
      () => new Date('2026-04-30T08:00:00.000Z'),
    );

    const response = await service.markActionTaken('abuse-report-1', { adminId: 'admin-1' });

    expect(audit.calls).toEqual([
      {
        entityType: 'abuse_report',
        entityId: 'abuse-report-1',
        action: 'reviewed_action_taken',
        actorType: ActorType.ADMIN,
        actorId: 'admin-1',
        metadata: {
          receiverId: 'receiver-1',
          reviewStatus: AbuseReportStatus.REVIEWED_ACTION_TAKEN,
          receiverResumed: false,
        },
      },
    ]);
    expect(response?.abuseReport.reviewStatus).toBe(AbuseReportStatus.REVIEWED_ACTION_TAKEN);
  });

  it('keeps the receiver paused when the review outcome is action taken', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const service = new AdminAbuseService(
      repository,
      new FakeAuditService() as unknown as AuditService,
      () => new Date('2026-04-30T08:00:00.000Z'),
    );

    await service.markActionTaken('abuse-report-1', { adminId: 'admin-1' });

    expect(repository.calls).not.toContainEqual(expect.objectContaining({ method: 'clearAbuseReviewPause' }));
  });

  it('records that a safe review did not resume a receiver another pending report still pauses', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    repository.clearPauseResult = { resumed: false };
    const audit = new FakeAuditService();
    const service = new AdminAbuseService(
      repository,
      audit as unknown as AuditService,
      () => new Date('2026-04-30T08:00:00.000Z'),
    );

    const response = await service.markSafe('abuse-report-1', { adminId: 'admin-1' });

    expect(response?.abuseReport.reviewStatus).toBe(AbuseReportStatus.REVIEWED_SAFE);
    expect(audit.calls).toEqual([
      expect.objectContaining({
        action: 'reviewed_safe',
        metadata: {
          receiverId: 'receiver-1',
          reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
          receiverResumed: false,
        },
      }),
    ]);
  });

  it('does not touch the pause when there is no pending report to review', async () => {
    const repository = new FakeAdminAbuseReportsRepository();
    const audit = new FakeAuditService();
    const service = new AdminAbuseService(repository, audit as unknown as AuditService);

    await expect(service.markSafe('missing-report', { adminId: 'admin-1' })).resolves.toBeNull();

    expect(repository.calls).not.toContainEqual(expect.objectContaining({ method: 'clearAbuseReviewPause' }));
    expect(audit.calls).toEqual([]);
  });
});

function abuseReportRecord(overrides: Partial<AdminAbuseReportRecord> = {}): AdminAbuseReportRecord {
  return {
    id: 'abuse-report-1',
    receiverId: 'receiver-1',
    reportedAt: new Date('2026-04-30T07:00:00.000Z'),
    reviewStatus: AbuseReportStatus.PENDING,
    reviewerAdminId: undefined,
    reviewedAt: undefined,
    hasReportContent: true,
    ...overrides,
  };
}
