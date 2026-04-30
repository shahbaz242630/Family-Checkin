import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from '../auth/admin-auth.service';
import { CheckInsService } from '../check-ins/check-ins.service';
import { AppConfigService } from '../../shared/config/app-config.service';
import { OperationsVisibilityService } from './operations-visibility.service';

@Controller('operations')
export class OperationsController {
  constructor(
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<CheckInsService, 'sendDueCheckIns' | 'escalateOverdueCheckIns'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'operationsCronSecret'>,
    @Inject(OperationsVisibilityService)
    private readonly operationsVisibilityService: Pick<OperationsVisibilityService, 'getCheckInSummary' | 'getCheckInDetail'>,
    @Inject(AdminAuthService)
    private readonly adminAuthService: Pick<AdminAuthService, 'verifyAdminAccessToken'>,
  ) {}

  @Post('check-ins/run')
  async runCheckIns(@Headers('authorization') authorization: string | undefined) {
    this.assertOperationsCronBearer(authorization);

    const dueCheckIns = await this.checkInsService.sendDueCheckIns();
    const overdueEscalations = await this.checkInsService.escalateOverdueCheckIns();

    return {
      ok: true,
      dueCheckIns,
      overdueEscalations,
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
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token || !this.isMatchingSecret(token, this.config.operationsCronSecret)) {
      throw new UnauthorizedException('Operations cron bearer token is required');
    }
  }

  private isMatchingSecret(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
