import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { CheckInsService } from '../check-ins/check-ins.service';
import type { AppConfigService } from '../../shared/config/app-config.service';
import type { AdminAuthService } from '../auth/admin-auth.service';
import type { OperationsVisibilityService } from './operations-visibility.service';
import { OperationsController } from './operations.controller';

class FakeCheckInsService {
  public calls: string[] = [];
  /** When true the run lock is held by another tick (CB-045). */
  public lockHeld = false;

  async runScheduledTick() {
    this.calls.push('runScheduledTick');
    if (this.lockHeld) {
      return { locked: true as const };
    }
    return {
      locked: false as const,
      dueCheckIns: {
        created: 2,
        sent: 2,
        skipped: 1,
        failed: 0,
      },
      cascadeAttempts: {
        sent: 3,
        timedOut: 2,
        failed: 1,
        needsAttention: 1,
        skipped: 1,
      },
    };
  }
}

class FakeOperationsVisibilityService {
  public calls: string[] = [];

  async getCheckInSummary() {
    this.calls.push('getCheckInSummary');
    return {
      ok: true,
      windowHours: 24,
      generatedAt: '2026-04-30T07:00:00.000Z',
      statusCounts: {
        ESCALATED: 1,
        RESOLVED: 2,
      },
      recent: [
        {
          checkInId: 'check-in-1',
          receiverId: 'receiver-1',
          status: 'RESOLVED',
          scheduledAt: '2026-04-30T06:30:00.000Z',
          resolvedAt: '2026-04-30T06:45:00.000Z',
          escalationAttemptCount: 1,
          successfulEscalationCount: 1,
        },
      ],
    };
  }

  async getCheckInDetail(checkInId: string) {
    this.calls.push(`getCheckInDetail:${checkInId}`);

    if (checkInId === 'missing-check-in') {
      return null;
    }

    return {
      ok: true,
      checkIn: {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        status: 'ESCALATED',
        channelUsed: 'SMS',
        scheduledAt: '2026-04-30T06:30:00.000Z',
        sentAt: '2026-04-30T06:31:00.000Z',
        escalationAttemptCount: 1,
        successfulEscalationCount: 1,
        escalations: [
          {
            id: 'escalation-1',
            attemptNumber: 1,
            channel: 'SMS',
            startedAt: '2026-04-30T07:01:00.000Z',
            completedAt: '2026-04-30T07:02:00.000Z',
            result: 'SUCCESS',
            senderNotifiedAt: '2026-04-30T07:03:00.000Z',
            backupAlertedAt: '2026-04-30T07:04:00.000Z',
          },
        ],
      },
    };
  }
}

class FakeAdminAuthService {
  public tokens: string[] = [];

  async verifyAdminAccessToken(token: string) {
    this.tokens.push(token);
    return {
      id: 'admin-id',
      authProviderId: 'supabase-admin-123',
      role: 'OPERATOR',
      active: true,
    };
  }
}

describe('OperationsController', () => {
  it('runs due check-ins and cascade attempts for a valid operations cron bearer token', async () => {
    const checkIns = new FakeCheckInsService();
    const controller = new OperationsController(
      checkIns as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    const response = await controller.runCheckIns('Bearer operations-cron-secret');

    expect(checkIns.calls).toEqual(['runScheduledTick']);
    expect(response).toEqual({
      ok: true,
      dueCheckIns: {
        created: 2,
        sent: 2,
        skipped: 1,
        failed: 0,
      },
      cascadeAttempts: {
        sent: 3,
        timedOut: 2,
        failed: 1,
        needsAttention: 1,
        skipped: 1,
      },
    });
    expect(JSON.stringify(response)).not.toContain('receiver');
    expect(JSON.stringify(response)).not.toContain('phone');
  });

  it('answers ok and locked, with no counts, when another tick holds the run lock (CB-045)', async () => {
    const checkIns = new FakeCheckInsService();
    checkIns.lockHeld = true;
    const controller = new OperationsController(
      checkIns as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.runCheckIns('Bearer operations-cron-secret')).resolves.toEqual({ ok: true, locked: true });
    expect(checkIns.calls).toEqual(['runScheduledTick']);
  });

  it('requires the configured operations cron bearer token', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.runCheckIns(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Basic operations-cron-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Bearer wrong-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a PII-safe check-in operations summary for a valid admin bearer token', async () => {
    const visibility = new FakeOperationsVisibilityService();
    const adminAuth = new FakeAdminAuthService();
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      visibility as unknown as OperationsVisibilityService,
      adminAuth as unknown as AdminAuthService,
    );

    const response = await controller.getCheckInSummary('Bearer admin-token');

    expect(adminAuth.tokens).toEqual(['admin-token']);
    expect(visibility.calls).toEqual(['getCheckInSummary']);
    expect(response).toEqual({
      ok: true,
      windowHours: 24,
      generatedAt: '2026-04-30T07:00:00.000Z',
      statusCounts: {
        ESCALATED: 1,
        RESOLVED: 2,
      },
      recent: [
        {
          checkInId: 'check-in-1',
          receiverId: 'receiver-1',
          status: 'RESOLVED',
          scheduledAt: '2026-04-30T06:30:00.000Z',
          resolvedAt: '2026-04-30T06:45:00.000Z',
          escalationAttemptCount: 1,
          successfulEscalationCount: 1,
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('phone');
    expect(JSON.stringify(response)).not.toContain('name');
    expect(JSON.stringify(response)).not.toContain('transcript');
    expect(JSON.stringify(response)).not.toContain('message');
  });

  it('requires an admin bearer token for the check-in summary', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.getCheckInSummary(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.getCheckInSummary('Basic admin-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a PII-safe check-in detail for a valid admin bearer token', async () => {
    const visibility = new FakeOperationsVisibilityService();
    const adminAuth = new FakeAdminAuthService();
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      visibility as unknown as OperationsVisibilityService,
      adminAuth as unknown as AdminAuthService,
    );

    const response = await controller.getCheckInDetail('Bearer admin-token', 'check-in-1');

    expect(adminAuth.tokens).toEqual(['admin-token']);
    expect(visibility.calls).toEqual(['getCheckInDetail:check-in-1']);
    expect(response).toEqual({
      ok: true,
      checkIn: {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        status: 'ESCALATED',
        channelUsed: 'SMS',
        scheduledAt: '2026-04-30T06:30:00.000Z',
        sentAt: '2026-04-30T06:31:00.000Z',
        escalationAttemptCount: 1,
        successfulEscalationCount: 1,
        escalations: [
          {
            id: 'escalation-1',
            attemptNumber: 1,
            channel: 'SMS',
            startedAt: '2026-04-30T07:01:00.000Z',
            completedAt: '2026-04-30T07:02:00.000Z',
            result: 'SUCCESS',
            senderNotifiedAt: '2026-04-30T07:03:00.000Z',
            backupAlertedAt: '2026-04-30T07:04:00.000Z',
          },
        ],
      },
    });
    expect(JSON.stringify(response)).not.toContain('phone');
    expect(JSON.stringify(response)).not.toContain('name');
    expect(JSON.stringify(response)).not.toContain('transcript');
    expect(JSON.stringify(response)).not.toContain('message');
  });

  it('returns not found when a check-in detail is missing', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.getCheckInDetail('Bearer admin-token', 'missing-check-in')).rejects.toMatchObject({
      status: 404,
    });
  });
});
