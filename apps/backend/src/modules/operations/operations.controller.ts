import { Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { CheckInsService } from '../check-ins/check-ins.service';
import { AppConfigService } from '../../shared/config/app-config.service';

@Controller('operations')
export class OperationsController {
  constructor(
    @Inject(CheckInsService)
    private readonly checkInsService: Pick<CheckInsService, 'sendDueCheckIns' | 'escalateOverdueCheckIns'>,
    @Inject(AppConfigService)
    private readonly config: Pick<AppConfigService, 'supabaseServiceRoleKey'>,
  ) {}

  @Post('check-ins/run')
  async runCheckIns(@Headers('authorization') authorization: string | undefined) {
    this.assertServiceRoleBearer(authorization);

    const dueCheckIns = await this.checkInsService.sendDueCheckIns();
    const overdueEscalations = await this.checkInsService.escalateOverdueCheckIns();

    return {
      ok: true,
      dueCheckIns,
      overdueEscalations,
    };
  }

  private assertServiceRoleBearer(authorization: string | undefined): void {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || token !== this.config.supabaseServiceRoleKey) {
      throw new UnauthorizedException('Service role bearer token is required');
    }
  }
}
