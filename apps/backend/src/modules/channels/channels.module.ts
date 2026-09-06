import { Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CHANNEL_PROVIDERS, CHANNEL_TEMPLATE_REPOSITORY } from './channels.tokens';
import { createChannelProviders } from './channel-providers.factory';
import { ChannelRouterService } from './channel-router.service';
import { FakeOutboundRecorder } from './fake-outbound-recorder';
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
    // One recorder per process. Fake providers write to it; in configured mode nothing does and it stays empty.
    FakeOutboundRecorder,
    {
      provide: CHANNEL_PROVIDERS,
      useFactory: (config: AppConfigService, catalog: MessageCatalogService, recorder: FakeOutboundRecorder) =>
        createChannelProviders(config, catalog, recorder),
      inject: [AppConfigService, MessageCatalogService, FakeOutboundRecorder],
    },
    ChannelRouterService,
  ],
  exports: [ChannelRouterService, MessageCatalogService, FakeOutboundRecorder],
})
export class ChannelsModule {}
