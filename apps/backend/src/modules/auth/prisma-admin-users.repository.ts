import { Inject, Injectable } from '@nestjs/common';
import type { AdminUser } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AdminUserRecord, AdminUsersRepository } from './admin-users.repository';

interface AdminUsersPrismaClient {
  adminUser: {
    findFirst(args: {
      where: { authProviderId: string };
      select: {
        id: true;
        authProviderId: true;
        role: true;
        active: true;
      };
    }): Promise<Pick<AdminUser, 'id' | 'authProviderId' | 'role' | 'active'> | null>;
  };
}

@Injectable()
export class PrismaAdminUsersRepository implements AdminUsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: AdminUsersPrismaClient | PrismaService) {}

  async findByAuthProviderId(authProviderId: string): Promise<AdminUserRecord | null> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { authProviderId },
      select: {
        id: true,
        authProviderId: true,
        role: true,
        active: true,
      },
    });

    return admin
      ? {
          id: admin.id,
          authProviderId: admin.authProviderId,
          role: admin.role,
          active: admin.active,
        }
      : null;
  }
}
