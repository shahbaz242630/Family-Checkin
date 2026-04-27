import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CheckInsModule } from './modules/check-ins/check-ins.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ReceiversModule } from './modules/receivers/receivers.module';
import { UsersModule } from './modules/users/users.module';
import { AppConfigModule } from './shared/config/app-config.module';

@Module({
  imports: [AppConfigModule, UsersModule, AuthModule, AuditModule, ReceiversModule, ChannelsModule, CheckInsModule],
})
export class AppModule {}
