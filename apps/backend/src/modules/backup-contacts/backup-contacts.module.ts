import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { BackupContactsController } from './backup-contacts.controller';
import { BackupContactsService } from './backup-contacts.service';
import { BACKUP_CONTACTS_REPOSITORY } from './backup-contacts.tokens';
import { PrismaBackupContactsRepository } from './prisma-backup-contacts.repository';

@Module({
  imports: [AuditModule, AuthModule, UsersModule],
  controllers: [BackupContactsController],
  providers: [
    PrismaService,
    {
      provide: BACKUP_CONTACTS_REPOSITORY,
      useClass: PrismaBackupContactsRepository,
    },
    {
      provide: CryptoService,
      useFactory: (config: AppConfigService) => new CryptoService(config.kmsMasterKey),
      inject: [AppConfigService],
    },
    BackupContactsService,
  ],
  exports: [BackupContactsService],
})
export class BackupContactsModule {}
