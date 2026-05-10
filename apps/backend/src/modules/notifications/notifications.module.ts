import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ExpoPushGateway } from './expo-push.gateway';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_NOTIFICATIONS_REPOSITORY } from './notifications.tokens';
import { PrismaNotificationsRepository } from './prisma-notifications.repository';

@Module({
  imports: [AuditModule, AuthModule, UsersModule],
  controllers: [NotificationsController],
  providers: [
    PrismaService,
    ExpoPushGateway,
    {
      provide: PUSH_NOTIFICATIONS_REPOSITORY,
      useClass: PrismaNotificationsRepository,
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
