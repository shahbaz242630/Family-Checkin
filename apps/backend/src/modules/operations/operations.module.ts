import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OperationsVisibilityService } from './operations-visibility.service';
import { OperationsController } from './operations.controller';
import { OPERATIONS_VISIBILITY_REPOSITORY } from './operations.tokens';
import { PrismaOperationsVisibilityRepository } from './prisma-operations-visibility.repository';

@Module({
  // NotificationsModule exports NotificationsService so the push-receipt cron route can drain Expo's
  // receipts without another push being sent (CB-085).
  imports: [AuthModule, CheckInsModule, NotificationsModule],
  providers: [
    PrismaService,
    {
      provide: OPERATIONS_VISIBILITY_REPOSITORY,
      useClass: PrismaOperationsVisibilityRepository,
    },
    OperationsVisibilityService,
  ],
  controllers: [OperationsController],
})
export class OperationsModule {}
