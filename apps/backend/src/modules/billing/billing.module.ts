import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { BillingController } from './billing.controller';
import { PrismaBillingRepository } from './prisma-billing.repository';
import { BillingService } from './billing.service';
import { BILLING_REPOSITORY } from './billing.tokens';

@Module({
  imports: [AuditModule, AuthModule, UsersModule],
  controllers: [BillingController],
  providers: [
    PrismaService,
    {
      provide: BILLING_REPOSITORY,
      useClass: PrismaBillingRepository,
    },
    {
      provide: BillingService,
      useFactory: (repository, auditService, config: AppConfigService) =>
        new BillingService(repository, auditService, undefined, config.revenueCatEntitlementId),
      inject: [BILLING_REPOSITORY, AuditService, AppConfigService],
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
