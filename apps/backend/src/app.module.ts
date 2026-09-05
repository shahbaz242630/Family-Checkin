import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountModule } from './modules/account/account.module';
import { AdminAbuseModule } from './modules/admin-abuse/admin-abuse.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupContactsModule } from './modules/backup-contacts/backup-contacts.module';
import { BillingModule } from './modules/billing/billing.module';
import { CheckInsModule } from './modules/check-ins/check-ins.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { EscalationsModule } from './modules/escalations/escalations.module';
import { OperationsModule } from './modules/operations/operations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProviderWebhooksModule } from './modules/provider-webhooks/provider-webhooks.module';
import { ReceiversModule } from './modules/receivers/receivers.module';
import { UsersModule } from './modules/users/users.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { AppConfigService } from './shared/config/app-config.service';
import { throttlerOptionsFromConfig } from './shared/http/http-hardening';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: throttlerOptionsFromConfig,
    }),
    AccountModule,
    UsersModule,
    AuthModule,
    AuditModule,
    ReceiversModule,
    BackupContactsModule,
    BillingModule,
    ChannelsModule,
    CheckInsModule,
    EscalationsModule,
    NotificationsModule,
    AdminAbuseModule,
    OperationsModule,
    ProviderWebhooksModule,
  ],
  providers: [
    // Global rate limit for every route; controllers that are machine-called and
    // authenticated by signature/secret opt out with @SkipThrottle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
