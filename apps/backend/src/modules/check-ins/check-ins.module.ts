import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChannelsModule } from '../channels/channels.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CheckInsService } from './check-ins.service';
import { CHECK_INS_REPOSITORY } from './check-ins.tokens';
import { PrismaCheckInsRepository } from './prisma-check-ins.repository';

@Module({
  imports: [AuditModule, ChannelsModule, EscalationsModule],
  providers: [
    PrismaService,
    {
      provide: CHECK_INS_REPOSITORY,
      useClass: PrismaCheckInsRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    CheckInsService,
  ],
  exports: [CheckInsService, CHECK_INS_REPOSITORY],
})
export class CheckInsModule {}
