import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';
import { UsersModule } from '../users/users.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AccountController } from './account.controller';
import { AccountPrivacyService } from './account-privacy.service';
import { PrismaAccountRepository } from './prisma-account.repository';
import { StepUpService } from './step-up.service';
import { ACCOUNT_REPOSITORY } from './account.tokens';

@Module({
  imports: [AuditModule, AuthModule, UsersModule, ChannelsModule],
  controllers: [AccountController],
  providers: [
    PrismaService,
    {
      provide: ACCOUNT_REPOSITORY,
      useClass: PrismaAccountRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    StepUpService,
    AccountPrivacyService,
  ],
  // ReceiversModule consumes REMOVE_RECEIVER step-up tokens; without this export its controller's optional
  // StepUpService resolves to undefined and every DELETE /receivers/:id is a 403 (found on the emulator, 2026-09-06).
  exports: [StepUpService],
})
export class AccountModule {}
