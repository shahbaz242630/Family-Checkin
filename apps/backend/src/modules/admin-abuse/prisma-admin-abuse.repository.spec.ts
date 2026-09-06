import { AbuseReportStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaAdminAbuseReportsRepository } from './prisma-admin-abuse.repository';

describe('PrismaAdminAbuseReportsRepository', () => {
  it('finds pending reports with a PII-safe select', async () => {
    const calls: unknown[] = [];
    const prisma = {
      abuseReport: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [
            {
              id: 'abuse-report-1',
              receiverId: 'receiver-1',
              reportedAt: new Date('2026-04-30T07:00:00.000Z'),
              reviewStatus: AbuseReportStatus.PENDING,
              reviewerAdminId: null,
              reviewedAt: null,
              reportContent: 'encrypted-report-content',
            },
          ];
        },
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      receiver: {
        updateMany: async () => ({ count: 0 }),
      },
    };
    const repository = new PrismaAdminAbuseReportsRepository(prisma);

    const reports = await repository.findPending({ limit: 25 });

    expect(calls).toEqual([
      {
        where: {
          reviewStatus: AbuseReportStatus.PENDING,
          receiver: { deletedAt: null },
        },
        select: {
          id: true,
          receiverId: true,
          reportedAt: true,
          reviewStatus: true,
          reviewerAdminId: true,
          reviewedAt: true,
          reportContent: true,
        },
        orderBy: { reportedAt: 'asc' },
        take: 25,
      },
    ]);
    expect(reports).toEqual([
      {
        id: 'abuse-report-1',
        receiverId: 'receiver-1',
        reportedAt: new Date('2026-04-30T07:00:00.000Z'),
        reviewStatus: AbuseReportStatus.PENDING,
        reviewerAdminId: undefined,
        reviewedAt: undefined,
        hasReportContent: true,
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('reporterPhoneHash');
    expect(JSON.stringify(calls)).not.toContain('nameEncrypted');
    expect(JSON.stringify(calls)).not.toContain('phoneEncrypted');
  });

  it('reviews only pending reports and returns the updated safe record', async () => {
    const calls: unknown[] = [];
    const prisma = {
      abuseReport: {
        findMany: async () => [],
        findFirst: async (args: unknown) => {
          calls.push({ method: 'findFirst', args });
          return {
            id: 'abuse-report-1',
            receiverId: 'receiver-1',
            reportedAt: new Date('2026-04-30T07:00:00.000Z'),
            reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
            reviewerAdminId: 'admin-1',
            reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
            reportContent: null,
          };
        },
        updateMany: async (args: unknown) => {
          calls.push({ method: 'updateMany', args });
          return { count: 1 };
        },
      },
      receiver: {
        updateMany: async () => ({ count: 0 }),
      },
    };
    const repository = new PrismaAdminAbuseReportsRepository(prisma);

    const report = await repository.reviewPending({
      abuseReportId: 'abuse-report-1',
      reviewerAdminId: 'admin-1',
      reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
      reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
    });

    expect(calls).toEqual([
      {
        method: 'updateMany',
        args: {
          where: {
            id: 'abuse-report-1',
            reviewStatus: AbuseReportStatus.PENDING,
            receiver: { deletedAt: null },
          },
          data: {
            reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
            reviewerAdminId: 'admin-1',
            reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
          },
        },
      },
      {
        method: 'findFirst',
        args: {
          where: {
            id: 'abuse-report-1',
            receiver: { deletedAt: null },
          },
          select: {
            id: true,
            receiverId: true,
            reportedAt: true,
            reviewStatus: true,
            reviewerAdminId: true,
            reviewedAt: true,
            reportContent: true,
          },
        },
      },
    ]);
    expect(report).toEqual({
      id: 'abuse-report-1',
      receiverId: 'receiver-1',
      reportedAt: new Date('2026-04-30T07:00:00.000Z'),
      reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
      reviewerAdminId: 'admin-1',
      reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
      hasReportContent: false,
    });
  });

  it('returns null when review update does not affect a pending report', async () => {
    const prisma = {
      abuseReport: {
        findMany: async () => [],
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      receiver: {
        updateMany: async () => ({ count: 0 }),
      },
    };
    const repository = new PrismaAdminAbuseReportsRepository(prisma);

    await expect(
      repository.reviewPending({
        abuseReportId: 'missing-report',
        reviewerAdminId: 'admin-1',
        reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
        reviewedAt: new Date('2026-04-30T08:00:00.000Z'),
      }),
    ).resolves.toBeNull();
  });

  it('clears only the abuse-review pause and only once no pending report remains', async () => {
    const calls: unknown[] = [];
    const prisma = {
      abuseReport: {
        findMany: async () => [],
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      receiver: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    const repository = new PrismaAdminAbuseReportsRepository(prisma);

    const result = await repository.clearAbuseReviewPause({ receiverId: 'receiver-1' });

    expect(result).toEqual({ resumed: true });
    expect(calls).toEqual([
      {
        where: {
          id: 'receiver-1',
          deletedAt: null,
          pausedReason: 'abuse_report_pending_review',
          abuseReports: { none: { reviewStatus: AbuseReportStatus.PENDING } },
        },
        data: {
          pausedUntil: null,
          pausedReason: null,
        },
      },
    ]);
  });

  it('reports no resume when the receiver was not paused for abuse review', async () => {
    const prisma = {
      abuseReport: {
        findMany: async () => [],
        findFirst: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
      receiver: {
        updateMany: async () => ({ count: 0 }),
      },
    };
    const repository = new PrismaAdminAbuseReportsRepository(prisma);

    await expect(repository.clearAbuseReviewPause({ receiverId: 'receiver-1' })).resolves.toEqual({ resumed: false });
  });
});
