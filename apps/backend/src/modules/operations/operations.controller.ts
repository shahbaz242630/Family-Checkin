import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminAuthService } from '../auth/admin-auth.service';
import { CheckInsService } from '../check-ins/check-ins.service';
import { assertBearerSecret } from '../../shared/auth/bearer-secret';
import { AppConfigService } from '../../shared/config/app-config.service';
import { OperationsVisibilityService } from './operations-visibility.service';

@Controller('operations')
export class OperationsController {
  constructor(
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<CheckInsService, 'runScheduledTick'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'operationsCronSecret'>,
    @Inject(OperationsVisibilityService)
    private readonly operationsVisibilityService: Pick<
      OperationsVisibilityService,
      'getCheckInSummary' | 'getCheckInDetail'
    >,
    @Inject(AdminAuthService)
    private readonly adminAuthService: Pick<AdminAuthService, 'verifyAdminAccessToken'>,
  ) {}

  // Called by the scheduler every 10 minutes in bursts and authenticated by the
  // cron secret (timing-safe compare), so the global rate limit is skipped here.
  // The admin GET routes below stay throttled. A tick that overlaps a running one
  // answers `{ ok: true, locked: true }` at once and sends nothing (CB-045).
  @SkipThrottle()
  @Post('check-ins/run')
  async runCheckIns(@Headers('authorization') authorization: string | undefined) {
    this.assertOperationsCronBearer(authorization);

    const tick = await this.checkInsService.runScheduledTick();
    if (tick.locked) {
      return { ok: true, locked: true };
    }

    return {
      ok: true,
      dueCheckIns: tick.dueCheckIns,
      cascadeAttempts: tick.cascadeAttempts,
    };
  }

  @Get('check-ins/summary')
  async getCheckInSummary(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    await this.adminAuthService.verifyAdminAccessToken(accessToken);

    return await this.operationsVisibilityService.getCheckInSummary();
  }

  @Get('check-ins/:checkInId')
  async getCheckInDetail(
    @Headers('authorization') authorization: string | undefined,
    @Param('checkInId') checkInId: string,
  ) {
    const accessToken = this.getBearerToken(authorization);
    await this.adminAuthService.verifyAdminAccessToken(accessToken);

    const detail = await this.operationsVisibilityService.getCheckInDetail(checkInId);
    if (!detail) {
      throw new NotFoundException('Check-in not found');
    }

    return detail;
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    return token;
  }

  private assertOperationsCronBearer(authorization: string | undefined): void {
    assertBearerSecret(authorization, this.config.operationsCronSecret, 'Operations cron bearer token is required');
  }
}
