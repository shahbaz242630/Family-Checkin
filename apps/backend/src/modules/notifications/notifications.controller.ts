import { Body, Controller, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { SupabaseAuthService } from '../auth/supabase-auth.service';
import { UsersService } from '../users/users.service';
import type { PushPlatform } from './notifications.repository';
import { NotificationsService } from './notifications.service';

interface RegisterDeviceTokenBody {
  token?: string;
  platform?: PushPlatform;
  deviceId?: string;
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

    return {
      deviceToken: await this.notificationsService.registerDeviceToken({
        userId: sender.id,
        token: body.token ?? '',
        platform: body.platform ?? 'ios',
        deviceId: body.deviceId,
        ipAddress: this.firstForwardedIp(forwardedFor),
        userAgent,
      }),
    };
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
