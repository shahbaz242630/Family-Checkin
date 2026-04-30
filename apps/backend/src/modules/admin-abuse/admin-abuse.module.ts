import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AdminAbuseController } from './admin-abuse.controller';
import { AdminAbuseService } from './admin-abuse.service';
import { ADMIN_ABUSE_REPORTS_REPOSITORY } from './admin-abuse.tokens';
import { PrismaAdminAbuseReportsRepository } from './prisma-admin-abuse.repository';

@Module({
  imports: [AuditModule, AuthModule],
  providers: [
    PrismaService,
    {
      provide: ADMIN_ABUSE_REPORTS_REPOSITORY,
      useClass: PrismaAdminAbuseReportsRepository,
    },
    AdminAbuseService,
  ],
  controllers: [AdminAbuseController],
})
export class AdminAbuseModule {}
