import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService } from './audit.service';
import { AUDIT_REPOSITORY } from './audit.tokens';
import { PrismaAuditRepository } from './prisma-audit.repository';

@Module({
  providers: [
    PrismaService,
    {
      provide: AUDIT_REPOSITORY,
      useClass: PrismaAuditRepository,
    },
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
