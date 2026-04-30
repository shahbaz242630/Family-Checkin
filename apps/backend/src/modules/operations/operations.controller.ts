import { timingSafeEqual } from 'node:crypto';
import { Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { CheckInsService } from '../check-ins/check-ins.service';
import { AppConfigService } from '../../shared/config/app-config.service';

@Controller('operations')
export class OperationsController {
  constructor(
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<CheckInsService, 'sendDueCheckIns' | 'escalateOverdueCheckIns'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'operationsCronSecret'>,
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
