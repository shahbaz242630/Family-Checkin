import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { CheckInsService } from '../check-ins/check-ins.service';
import type { AppConfigService } from '../../shared/config/app-config.service';
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

describe('OperationsController', () => {
  it('runs due check-ins and overdue escalation for a valid service-role bearer token', async () => {
    const checkIns = new FakeCheckInsService();
    const controller = new OperationsController(
      checkIns as unknown as CheckInsService,
      { supabaseServiceRoleKey: 'service-role-secret' } as AppConfigService,
    );

    const response = await controller.runCheckIns('Bearer service-role-secret');

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

  it('requires the configured service-role bearer token', async () => {
    const controller = new OperationsController(
      new FakeCheckInsService() as unknown as CheckInsService,
      { supabaseServiceRoleKey: 'service-role-secret' } as AppConfigService,
    );

    await expect(controller.runCheckIns(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Basic service-role-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.runCheckIns('Bearer wrong-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
