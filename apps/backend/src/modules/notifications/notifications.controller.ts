import { BadRequestException, Body, Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import type { PushPlatform } from './notifications.repository';
import { INVALID_PUSH_TOKEN_MESSAGE, NotificationsService } from './notifications.service';

interface RegisterDeviceTokenBody {
  token?: string;
  platform?: string;
  deviceId?: string;
}

/** Validated at the API boundary, not as a database enum, so a new platform is a code change only (CB-023). */
const PUSH_PLATFORMS: readonly PushPlatform[] = ['ios', 'android', 'web'];
const INVALID_PLATFORM_MESSAGE = `platform must be one of ${PUSH_PLATFORMS.join(', ')}`;

function parsePlatform(value: unknown): PushPlatform {
  if (typeof value === 'string' && (PUSH_PLATFORMS as readonly string[]).includes(value)) {
    return value as PushPlatform;
  }
  throw new BadRequestException(INVALID_PLATFORM_MESSAGE);
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
    @Body() body: RegisterDeviceTokenBody,
  ) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const sender = await this.usersService.upsertFromSupabaseIdentity(identity);
    const platform = parsePlatform(body?.platform);

    try {
      return {
        deviceToken: await this.notificationsService.registerDeviceToken({
          userId: sender.id,
          token: typeof body?.token === 'string' ? body.token : '',
          platform,
          deviceId: typeof body?.deviceId === 'string' ? body.deviceId : undefined,
          ipAddress: this.firstForwardedIp(forwardedFor),
          userAgent,
        }),
      };
    } catch (error) {
      if (error instanceof Error && error.message === INVALID_PUSH_TOKEN_MESSAGE) {
        throw new BadRequestException(INVALID_PUSH_TOKEN_MESSAGE);
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
