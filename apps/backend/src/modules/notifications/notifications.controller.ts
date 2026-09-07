import { BadRequestException, Body, Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { registerDeviceTokenBodySchema, type RegisterDeviceTokenBody } from '@nearby/shared-types';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import { DomainError } from '../../shared/validation/domain-error';
import { toHttpFailure } from '../../shared/validation/domain-error.interceptor';
import { ZodBodyPipe } from '../../shared/validation/zod-body.pipe';
import type { PushPlatform } from './notifications.repository';
import { INVALID_PUSH_TOKEN_CODE, INVALID_PUSH_TOKEN_MESSAGE, NotificationsService } from './notifications.service';

/** Validated at the API boundary, not as a database enum, so a new platform is a code change only (CB-023). */
const PUSH_PLATFORMS: readonly PushPlatform[] = ['ios', 'android', 'web'];
const INVALID_PLATFORM_MESSAGE = `platform must be one of ${PUSH_PLATFORMS.join(', ')}`;
export const INVALID_PUSH_PLATFORM_CODE = 'INVALID_PUSH_PLATFORM';

function parsePlatform(value: unknown): PushPlatform {
  if (typeof value === 'string' && (PUSH_PLATFORMS as readonly string[]).includes(value)) {
    return value as PushPlatform;
  }
  throw new BadRequestException({ code: INVALID_PUSH_PLATFORM_CODE, message: INVALID_PLATFORM_MESSAGE });
}

@Controller('device-tokens')
export class NotificationsController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: SupabaseAuthService,
    @Inject(UsersService)
    private readonly usersService: UsersService,
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService,
  ) {}

  @Post()
  async register(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodBodyPipe(registerDeviceTokenBodySchema)) body: RegisterDeviceTokenBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.findOrCreateFromSupabaseIdentity(identity);
    const platform = parsePlatform(body?.platform);

    try {
      return {
        deviceToken: await this.notificationsService.registerDeviceToken({
          userId: sender.id,
          token: body.token,
          platform,
          deviceId: body.deviceId,
          ipAddress: this.firstForwardedIp(forwardedFor),
          userAgent,
        }),
      };
    } catch (error) {
      // A refused push token is the caller's mistake, so it answers 400 with a code, never a 500 (CB-042).
      if (error instanceof DomainError) {
        throw toHttpFailure(error);
      }
      if (error instanceof Error && error.message === INVALID_PUSH_TOKEN_MESSAGE) {
        throw new BadRequestException({ code: INVALID_PUSH_TOKEN_CODE, message: INVALID_PUSH_TOKEN_MESSAGE });
      }
      throw error;
    }
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    return token;
  }

  private firstForwardedIp(forwardedFor: string | undefined): string | undefined {
    return forwardedFor?.split(',')[0]?.trim() || undefined;
  }
}
