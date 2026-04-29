import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChannelsModule } from '../channels/channels.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ESCALATIONS_REPOSITORY } from './escalations.tokens';
import { EscalationsService } from './escalations.service';
import { PrismaEscalationsRepository } from './prisma-escalations.repository';

@Module({
  imports: [AuditModule, ChannelsModule],
  providers: [
    PrismaService,
    {
      provide: ESCALATIONS_REPOSITORY,
      useClass: PrismaEscalationsRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    EscalationsService,
  ],
  exports: [EscalationsService],
})
export class EscalationsModule {}
