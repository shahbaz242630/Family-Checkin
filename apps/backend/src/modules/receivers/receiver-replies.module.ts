import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ChannelProviderMode } from '../../shared/config/app-config.service';
import { ReceiverRepliesController } from './receiver-replies.controller';
import { ReceiversModule } from './receivers.module';

export interface ReceiverRepliesModuleOptions {
  channelProviderMode: ChannelProviderMode;
}

/**
 * Hosts `POST /receiver-replies/fake`, the provider-free way to drive inbound replies in local testing.
 * The controller is registered only in fake mode, so against real providers the route does not exist
 * (404) rather than being one missing guard away from closing check-ins. The decision has to be made
 * here, when the module graph is built, because Nest cannot add or remove a controller after boot.
 */
@Module({})
export class ReceiverRepliesModule {
  static register(options: ReceiverRepliesModuleOptions): DynamicModule {
    return {
      module: ReceiverRepliesModule,
      imports: [ReceiversModule],
      controllers: options.channelProviderMode === 'fake' ? [ReceiverRepliesController] : [],
    };
  }
}
