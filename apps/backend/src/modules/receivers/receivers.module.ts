import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BackupContactsModule } from '../backup-contacts/backup-contacts.module';
import { BillingModule } from '../billing/billing.module';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { ChannelsModule } from '../channels/channels.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaReceiversRepository } from './prisma-receivers.repository';
import { ReceiverReplyService } from './receiver-reply.service';
import { ReceiverConsentService } from './receiver-consent.service';
import { ReceiversController } from './receivers.controller';
import { RECEIVERS_REPOSITORY } from './receivers.tokens';
import { ReceiversService } from './receivers.service';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    UsersModule,
    ChannelsModule,
    CheckInsModule,
    EscalationsModule,
    BackupContactsModule,
    BillingModule,
    // Provides StepUpService for the remove-receiver step-up (REMOVE_RECEIVER token consumption).
    AccountModule,
    // Quiet sender pushes on consent answers, STOP and backup DONE (CB-012).
    NotificationsModule,
  ],
  // The fake reply route lives in ReceiverRepliesModule so it can be left out entirely in configured mode.
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
    ReceiverReplyService,
  ],
  exports: [ReceiversService, ReceiverConsentService, ReceiverReplyService],
})
export class ReceiversModule {}
