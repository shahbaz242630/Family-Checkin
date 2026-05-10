import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelRouterService } from '../channels/channel-router.service';
import { EscalationsModule } from '../escalations/escalations.module';
import { EscalationsService } from '../escalations/escalations.service';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CheckInsService } from './check-ins.service';
import type { CheckInsRepository } from './check-ins.repository';
import { CHECK_INS_REPOSITORY, VOICE_CALLER_ID_REPOSITORY } from './check-ins.tokens';
import { PrismaCheckInsRepository } from './prisma-check-ins.repository';
import { PrismaVoiceCallerIdRepository } from './prisma-voice-caller-id.repository';
import type { VoiceCallerIdRepository } from './voice-caller-id.repository';

@Module({
  imports: [AuditModule, BillingModule, ChannelsModule, EscalationsModule],
  providers: [
    PrismaService,
    {
      provide: CHECK_INS_REPOSITORY,
      useClass: PrismaCheckInsRepository,
    },
    {
      provide: VOICE_CALLER_ID_REPOSITORY,
      useClass: PrismaVoiceCallerIdRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    {
      provide: CheckInsService,
      useFactory: (
        repository: CheckInsRepository,
        cryptoService: CryptoService,
        channelRouter: ChannelRouterService,
        auditService: AuditService,
        escalationsService: EscalationsService,
        billingService: BillingService,
        voiceCallerIds: VoiceCallerIdRepository,
      ) =>
        new CheckInsService(
          repository,
          cryptoService,
          channelRouter,
          auditService,
          escalationsService,
          undefined,
          billingService,
          voiceCallerIds,
        ),
      inject: [
        CHECK_INS_REPOSITORY,
        CryptoService,
        ChannelRouterService,
        AuditService,
        EscalationsService,
        BillingService,
        VOICE_CALLER_ID_REPOSITORY,
      ],
    },
  ],
  exports: [CheckInsService, CHECK_INS_REPOSITORY],
})
export class CheckInsModule {}
