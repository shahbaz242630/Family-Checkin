import { Module } from '@nestjs/common';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OperationsVisibilityService } from './operations-visibility.service';
import { OperationsController } from './operations.controller';
import { OPERATIONS_VISIBILITY_REPOSITORY } from './operations.tokens';
import { PrismaOperationsVisibilityRepository } from './prisma-operations-visibility.repository';

@Module({
  imports: [CheckInsModule],
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
