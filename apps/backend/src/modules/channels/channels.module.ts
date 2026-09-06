import { Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CHANNEL_PROVIDERS, CHANNEL_TEMPLATE_REPOSITORY } from './channels.tokens';
import { createChannelProviders } from './channel-providers.factory';
import { ChannelRouterService } from './channel-router.service';
import { MessageCatalogService } from './message-catalog.service';
import { PrismaChannelTemplateRepository } from './prisma-channel-template.repository';

@Module({
  providers: [
    PrismaService,
    {
      provide: CHANNEL_TEMPLATE_REPOSITORY,
      useClass: PrismaChannelTemplateRepository,
    },
    MessageCatalogService,
    {
      provide: CHANNEL_PROVIDERS,
      useFactory: (config: AppConfigService, catalog: MessageCatalogService) => createChannelProviders(config, catalog),
      inject: [AppConfigService, MessageCatalogService],
    },
    ChannelRouterService,
  ],
  exports: [ChannelRouterService, MessageCatalogService],
})
export class ChannelsModule {}
