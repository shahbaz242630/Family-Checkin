import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import type { AdminUserRecord, AdminUsersRepository } from './admin-users.repository';
import { ADMIN_USERS_REPOSITORY } from './auth.tokens';
import { SupabaseAuthService } from './supabase-auth.service';

const ALL_ADMIN_ROLES = [AdminRole.SUPER_ADMIN, AdminRole.OPERATOR, AdminRole.SUPPORT_READONLY];

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(SupabaseAuthService)
    private readonly supabaseAuthService: Pick<SupabaseAuthService, 'verifyAccessToken'>,
    @Inject(ADMIN_USERS_REPOSITORY)
    private readonly adminUsersRepository: AdminUsersRepository,
  ) {}

  async verifyAdminAccessToken(
    accessToken: string,
    allowedRoles: AdminRole[] = ALL_ADMIN_ROLES,
  ): Promise<AdminUserRecord> {
    const identity = await this.supabaseAuthService.verifyAccessToken(accessToken);
    const admin = await this.adminUsersRepository.findByAuthProviderId(identity.authProviderId);

    if (!admin?.active || !allowedRoles.includes(admin.role)) {
      throw new ForbiddenException('Active admin access is required');
    }

    return admin;
  }
}
