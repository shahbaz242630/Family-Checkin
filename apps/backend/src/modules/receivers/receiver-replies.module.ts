import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ChannelProviderMode } from '../../shared/config/app-config.service';
import { ChannelsModule } from '../channels/channels.module';
import { ReceiverRepliesController } from './receiver-replies.controller';
import { ReceiversModule } from './receivers.module';

export interface ReceiverRepliesModuleOptions {
  channelProviderMode: ChannelProviderMode;
}

/**
 * Hosts `POST /receiver-replies/fake` (provider-free inbound replies) and `GET /receiver-replies/fake/outbound`
 * (what the fake providers sent), the local-testing pair. The controller is registered only in fake mode, so
 * against real providers neither route exists (404) rather than being one missing guard away from closing
 * check-ins or listing message bodies. The decision has to be made here, when the module graph is built,
 * because Nest cannot add or remove a controller after boot.
 */
@Module({})
export class ReceiverRepliesModule {
  static register(options: ReceiverRepliesModuleOptions): DynamicModule {
    return {
      module: ReceiverRepliesModule,
      imports: [ReceiversModule, ChannelsModule],
      controllers: options.channelProviderMode === 'fake' ? [ReceiverRepliesController] : [],
    };
  }
}
