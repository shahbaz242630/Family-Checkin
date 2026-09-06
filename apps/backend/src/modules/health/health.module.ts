import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  // Module-local PrismaService like every other module until CB-049 introduces one global PrismaModule.
  providers: [PrismaService],
})
export class HealthModule {}
