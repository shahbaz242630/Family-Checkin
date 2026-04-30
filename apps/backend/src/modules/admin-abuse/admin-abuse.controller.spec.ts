import { AdminRole, AbuseReportStatus } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AdminAuthService } from '../auth/admin-auth.service';
import type { AdminAbuseService } from './admin-abuse.service';
import { AdminAbuseController } from './admin-abuse.controller';

class FakeAdminAuthService {
  public calls: unknown[] = [];

  async verifyAdminAccessToken(token: string, allowedRoles?: AdminRole[]) {
    this.calls.push({ token, allowedRoles });
    return {
      id: 'admin-1',
      authProviderId: 'supabase-admin-1',
      role: AdminRole.OPERATOR,
      active: true,
    };
  }
}

class FakeAdminAbuseService {
  public calls: unknown[] = [];

  async listPendingReports() {
    this.calls.push({ method: 'listPendingReports' });
    return {
      ok: true,
      abuseReports: [],
    };
  }

  async getReport(abuseReportId: string) {
    this.calls.push({ method: 'getReport', abuseReportId });

    if (abuseReportId === 'missing-report') {
      return null;
    }

    return {
      ok: true,
      abuseReport: {
        id: abuseReportId,
        receiverId: 'receiver-1',
        reportedAt: '2026-04-30T07:00:00.000Z',
        reviewStatus: AbuseReportStatus.PENDING,
        hasReportContent: true,
      },
    };
  }

  async markSafe(abuseReportId: string, input: { adminId: string }) {
    this.calls.push({ method: 'markSafe', abuseReportId, input });
    return {
      ok: true,
      abuseReport: {
        id: abuseReportId,
        receiverId: 'receiver-1',
        reportedAt: '2026-04-30T07:00:00.000Z',
        reviewStatus: AbuseReportStatus.REVIEWED_SAFE,
        reviewerAdminId: input.adminId,
        reviewedAt: '2026-04-30T08:00:00.000Z',
        hasReportContent: true,
      },
    };
  }

  async markActionTaken(abuseReportId: string, input: { adminId: string }) {
    this.calls.push({ method: 'markActionTaken', abuseReportId, input });
    return {
      ok: true,
      abuseReport: {
        id: abuseReportId,
        receiverId: 'receiver-1',
        reportedAt: '2026-04-30T07:00:00.000Z',
        reviewStatus: AbuseReportStatus.REVIEWED_ACTION_TAKEN,
        reviewerAdminId: input.adminId,
        reviewedAt: '2026-04-30T08:00:00.000Z',
        hasReportContent: true,
      },
    };
  }
}

describe('AdminAbuseController', () => {
  it('lists pending abuse reports for any active admin role', async () => {
    const adminAuth = new FakeAdminAuthService();
    const abuse = new FakeAdminAbuseService();
    const controller = new AdminAbuseController(
      adminAuth as unknown as AdminAuthService,
      abuse as unknown as AdminAbuseService,
    );

    const response = await controller.listPendingReports('Bearer admin-token');

    expect(adminAuth.calls).toEqual([{ token: 'admin-token', allowedRoles: undefined }]);
    expect(abuse.calls).toEqual([{ method: 'listPendingReports' }]);
    expect(response).toEqual({ ok: true, abuseReports: [] });
  });

  it('returns a PII-safe abuse report detail for any active admin role', async () => {
    const adminAuth = new FakeAdminAuthService();
    const abuse = new FakeAdminAbuseService();
    const controller = new AdminAbuseController(
      adminAuth as unknown as AdminAuthService,
      abuse as unknown as AdminAbuseService,
    );

    const response = await controller.getReport('Bearer admin-token', 'abuse-report-1');

    expect(adminAuth.calls).toEqual([{ token: 'admin-token', allowedRoles: undefined }]);
    expect(abuse.calls).toEqual([{ method: 'getReport', abuseReportId: 'abuse-report-1' }]);
    expect(response).toEqual({
      ok: true,
      abuseReport: {
        id: 'abuse-report-1',
        receiverId: 'receiver-1',
        reportedAt: '2026-04-30T07:00:00.000Z',
        reviewStatus: AbuseReportStatus.PENDING,
        hasReportContent: true,
      },
    });
    expect(JSON.stringify(response)).not.toContain('phone');
    expect(JSON.stringify(response)).not.toContain('name');
    expect(JSON.stringify(response)).not.toContain('reportContent');
    expect(JSON.stringify(response)).not.toContain('reporter');
  });

  it('limits review actions to super admins and operators', async () => {
    const adminAuth = new FakeAdminAuthService();
    const abuse = new FakeAdminAbuseService();
    const controller = new AdminAbuseController(
      adminAuth as unknown as AdminAuthService,
      abuse as unknown as AdminAbuseService,
    );

    const response = await controller.markSafe('Bearer admin-token', 'abuse-report-1');

    expect(adminAuth.calls).toEqual([
      {
        token: 'admin-token',
        allowedRoles: [AdminRole.SUPER_ADMIN, AdminRole.OPERATOR],
      },
    ]);
    expect(abuse.calls).toEqual([{ method: 'markSafe', abuseReportId: 'abuse-report-1', input: { adminId: 'admin-1' } }]);
    expect(response.abuseReport.reviewStatus).toBe(AbuseReportStatus.REVIEWED_SAFE);
  });

  it('marks action taken through the restricted review path', async () => {
    const adminAuth = new FakeAdminAuthService();
    const abuse = new FakeAdminAbuseService();
    const controller = new AdminAbuseController(
      adminAuth as unknown as AdminAuthService,
      abuse as unknown as AdminAbuseService,
    );

    const response = await controller.markActionTaken('Bearer admin-token', 'abuse-report-1');

    expect(adminAuth.calls).toEqual([
      {
        token: 'admin-token',
        allowedRoles: [AdminRole.SUPER_ADMIN, AdminRole.OPERATOR],
      },
    ]);
    expect(abuse.calls).toEqual([
      { method: 'markActionTaken', abuseReportId: 'abuse-report-1', input: { adminId: 'admin-1' } },
    ]);
    expect(response.abuseReport.reviewStatus).toBe(AbuseReportStatus.REVIEWED_ACTION_TAKEN);
  });

  it('requires a bearer token', async () => {
    const controller = new AdminAbuseController(
      new FakeAdminAuthService() as unknown as AdminAuthService,
      new FakeAdminAbuseService() as unknown as AdminAbuseService,
    );

    await expect(controller.listPendingReports(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.listPendingReports('Basic admin-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns not found when a report does not exist', async () => {
    const controller = new AdminAbuseController(
      new FakeAdminAuthService() as unknown as AdminAuthService,
      new FakeAdminAbuseService() as unknown as AdminAbuseService,
    );

    await expect(controller.getReport('Bearer admin-token', 'missing-report')).rejects.toMatchObject({
      status: 404,
    });
  });
});
