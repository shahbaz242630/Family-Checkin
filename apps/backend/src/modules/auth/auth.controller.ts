import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly supabaseAuthService: SupabaseAuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('sync-user')
  async syncUser(@Headers('authorization') authorization: string | undefined) {
    const accessToken = this.getBearerToken(authorization);
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const user = await this.usersService.upsertFromSupabaseIdentity(identity);

    return {
      user: {
        id: user.id,
        country: user.country,
        preferredLanguage: user.preferredLanguage,
        timezone: user.timezone,
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
