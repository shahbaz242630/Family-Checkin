import { Module } from '@nestjs/common';
import { CheckInsModule } from '../check-ins/check-ins.module';
import { ReceiversModule } from '../receivers/receivers.module';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ProviderWebhooksController } from './provider-webhooks.controller';
import { PrismaProviderWebhookEventsRepository } from './prisma-provider-webhook-events.repository';
import { PROVIDER_WEBHOOK_EVENTS_REPOSITORY } from './provider-webhooks.tokens';

@Module({
  imports: [CheckInsModule, ReceiversModule],
  controllers: [ProviderWebhooksController],
  providers: [
    PrismaService,
    {
      provide: PROVIDER_WEBHOOK_EVENTS_REPOSITORY,
      useClass: PrismaProviderWebhookEventsRepository,
    },
  ],
})
export class ProviderWebhooksModule {}
