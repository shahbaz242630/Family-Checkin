import { Module } from '@nestjs/common';
import { ReceiversModule } from '../receivers/receivers.module';
import { ProviderWebhooksController } from './provider-webhooks.controller';

@Module({
  imports: [ReceiversModule],
  controllers: [ProviderWebhooksController],
})
export class ProviderWebhooksModule {}
