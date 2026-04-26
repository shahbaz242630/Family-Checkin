import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';
import { UsersModule } from '../users/users.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaReceiversRepository } from './prisma-receivers.repository';
import { ReceiverConsentService } from './receiver-consent.service';
import { ReceiversController } from './receivers.controller';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';
import { ReceiversService } from './receivers.service';

@Module({
  imports: [AuditModule, AuthModule, UsersModule, ChannelsModule],
  controllers: [ReceiversController],
  providers: [
    PrismaService,
    {
      provide: RECEIVERS_REPOSITORY,
      useClass: PrismaReceiversRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    ReceiversService,
    ReceiverConsentService,
  ],
  exports: [ReceiversService, ReceiverConsentService],
})
export class ReceiversModule {}
