import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { ADMIN_USERS_REPOSITORY } from './auth.tokens';
import { PrismaAdminUsersRepository } from './prisma-admin-users.repository';
import { SupabaseAuthService } from './supabase-auth.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    PrismaService,
    SupabaseAuthService,
    {
      provide: ADMIN_USERS_REPOSITORY,
      useClass: PrismaAdminUsersRepository,
    },
    AdminAuthService,
  ],
  exports: [SupabaseAuthService, AdminAuthService],
})
export class AuthModule {}
