import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupContactsModule } from './modules/backup-contacts/backup-contacts.module';
import { CheckInsModule } from './modules/check-ins/check-ins.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { EscalationsModule } from './modules/escalations/escalations.module';
import { OperationsModule } from './modules/operations/operations.module';
import { ReceiversModule } from './modules/receivers/receivers.module';
import { UsersModule } from './modules/users/users.module';
import { AppConfigModule } from './shared/config/app-config.module';

@Module({
  imports: [
    AppConfigModule,
    UsersModule,
    AuthModule,
    AuditModule,
    ReceiversModule,
    BackupContactsModule,
    ChannelsModule,
    CheckInsModule,
    EscalationsModule,
    OperationsModule,
  ],
})
export class AppModule {}
