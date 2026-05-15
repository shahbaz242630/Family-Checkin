import { Body, Controller, Delete, ForbiddenException, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { SensitiveAction } from '@prisma/client';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import type { SenderRecord } from '../users/users.repository';
import { AccountPrivacyService } from './account-privacy.service';
import { StepUpService } from './step-up.service';

@Controller('account')
export class AccountController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: Pick<SupabaseAuthService, 'verifyAccessToken'>,
    @Inject(UsersService)
    private readonly usersService: Pick<UsersService, 'upsertFromSupabaseIdentity'>,
    @Inject(StepUpService)
    private readonly stepUpService: Pick<StepUpService, 'requestStepUp' | 'verifyStepUp'>,
    @Inject(AccountPrivacyService)
    private readonly accountPrivacyService: Pick<AccountPrivacyService, 'exportAccount' | 'deleteAccount'>,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
  ) {}

  @Post('step-up/request')
  async requestStepUp(@Headers('authorization') authorization: string | undefined, @Body() body: { action?: SensitiveAction }) {
    const sender = await this.authenticateSender(authorization);
    const action = this.parseSensitiveAction(body.action);

    return this.stepUpService.requestStepUp({
      userId: sender.id,
      action,
      phone: this.cryptoService.decrypt(sender.phoneEncrypted),
      language: sender.preferredLanguage,
    });
  }

  @Post('step-up/verify')
  async verifyStepUp(@Headers('authorization') authorization: string | undefined, @Body() body: { challengeId?: string; code?: string }) {
    const sender = await this.authenticateSender(authorization);

    return this.stepUpService.verifyStepUp({
      userId: sender.id,
      challengeId: this.required(body.challengeId, 'challengeId is required'),
      code: this.required(body.code, 'code is required'),
    });
  }

  @Get('export')
  async exportAccount(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-nearby-step-up-token') stepUpToken: string | undefined,
  ) {
    const sender = await this.authenticateSender(authorization);

    return this.accountPrivacyService.exportAccount({
      userId: sender.id,
      stepUpToken: this.requiredStepUpToken(stepUpToken),
    });
  }

  @Delete()
  async deleteAccount(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-nearby-step-up-token') stepUpToken: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const sender = await this.authenticateSender(authorization);

    return this.accountPrivacyService.deleteAccount({
      userId: sender.id,
      stepUpToken: this.requiredStepUpToken(stepUpToken),
      ipAddress: this.firstForwardedIp(forwardedFor),
      userAgent,
    });
  }

  private async authenticateSender(authorization: string | undefined): Promise<SenderRecord> {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    return this.usersService.upsertFromSupabaseIdentity(identity);
  }

  private parseSensitiveAction(action: SensitiveAction | undefined): SensitiveAction {
    if (
      action === SensitiveAction.EXPORT_DATA ||
      action === SensitiveAction.DELETE_ACCOUNT ||
      action === SensitiveAction.REMOVE_RECEIVER
    ) {
      return action;
    }

    throw new ForbiddenException('Unsupported sensitive action');
  }

  private required(value: string | undefined, message: string): string {
    if (!value?.trim()) {
      throw new ForbiddenException(message);
    }

    return value.trim();
  }

  private requiredStepUpToken(value: string | undefined): string {
    if (!value?.trim()) {
      throw new ForbiddenException('Step-up verification is required');
    }

    return value.trim();
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return token;
  }

  private firstForwardedIp(forwardedFor: string | undefined): string | undefined {
    return forwardedFor?.split(',')[0]?.trim() || undefined;
  }
}
