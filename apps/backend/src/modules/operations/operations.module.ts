import { Module } from '@nestjs/common';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { OperationsController } from './operations.controller';

@Module({
  imports: [CheckInsModule],
  controllers: [OperationsController],
})
export class OperationsModule {}
