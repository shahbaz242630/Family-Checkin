import { Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { CHANNEL_PROVIDERS } from './channels.tokens';
import { createChannelProviders } from './channel-providers.factory';
import { ChannelRouterService } from './channel-router.service';

@Module({
  providers: [
    {
      provide: CHANNEL_PROVIDERS,
      useFactory: (config: AppConfigService) => createChannelProviders(config),
      inject: [AppConfigService],
    },
    ChannelRouterService,
  ],
  exports: [ChannelRouterService],
})
export class ChannelsModule {}
