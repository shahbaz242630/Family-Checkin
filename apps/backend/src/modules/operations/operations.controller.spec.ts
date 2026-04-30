import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { CheckInsService } from '../check-ins/check-ins.service';
import type { AppConfigService } from '../../shared/config/app-config.service';
import type { OperationsVisibilityService } from './operations-visibility.service';
import { OperationsController } from './operations.controller';

class FakeCheckInsService {
  public calls: string[] = [];

  async sendDueCheckIns() {
    this.calls.push('sendDueCheckIns');
    return {
      created: 2,
      sent: 2,
      skipped: 1,
    };
  }

  async escalateOverdueCheckIns() {
    this.calls.push('escalateOverdueCheckIns');
    return {
      checked: 3,
      escalated: 1,
      skipped: 1,
      failed: 1,
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
}

describe('OperationsController', () => {
  it('runs due check-ins and overdue escalation for a valid operations cron bearer token', async () => {
    const checkIns = new FakeCheckInsService();
    const controller = new OperationsController(
      checkIns as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
    );

    const response = await controller.runCheckIns('Bearer operations-cron-secret');

    expect(checkIns.calls).toEqual(['sendDueCheckIns', 'escalateOverdueCheckIns']);
    expect(response).toEqual({
      ok: true,
      dueCheckIns: {
        created: 2,
        sent: 2,
        skipped: 1,
      },
      overdueEscalations: {
        checked: 3,
        escalated: 1,
        skipped: 1,
        failed: 1,
      },
    });
    expect(JSON.stringify(response)).not.toContain('receiver');
    expect(JSON.stringify(response)).not.toContain('phone');
  });

  it('requires the configured operations cron bearer token', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
    );

    await expect(controller.runCheckIns(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Basic operations-cron-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Bearer wrong-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a PII-safe check-in operations summary for a valid operations cron bearer token', async () => {
    const visibility = new FakeOperationsVisibilityService();
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      visibility as unknown as OperationsVisibilityService,
    );

    const response = await controller.getCheckInSummary('Bearer operations-cron-secret');

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

  it('requires the configured operations cron bearer token for the check-in summary', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { operationsCronSecret: 'operations-cron-secret' } as AppConfigService,
      new FakeOperationsVisibilityService() as unknown as OperationsVisibilityService,
    );

    await expect(controller.getCheckInSummary(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.getCheckInSummary('Bearer wrong-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
