import { Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AdminAuthService } from './admin-auth.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: Pick<SupabaseAuthService, 'verifyAccessToken'>,
    @Inject(UsersService)
    private readonly usersService: Pick<UsersService, 'syncProfileFromSupabaseIdentity'>,
    @Inject(AdminAuthService)
    private readonly adminAuthService: Pick<AdminAuthService, 'verifyAdminAccessToken'>,
  ) {}

  /** The only route that writes the sender's profile columns from the Supabase identity (CB-024). */
  @Post('sync-user')
  async syncUser(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const user = await this.usersService.syncProfileFromSupabaseIdentity(identity);

    return {
      user: {
        id: user.id,
        country: user.country,
        preferredLanguage: user.preferredLanguage,
        timezone: user.timezone,
      },
    };
  }

  @Get('admin/me')
  async adminMe(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    const admin = await this.adminAuthService.verifyAdminAccessToken(accessToken);

    return {
      admin: {
        id: admin.id,
        role: admin.role,
      },
    };
  }

  private getBearerToken(authorization: string | undefined): string {
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    return token;
  }
}
