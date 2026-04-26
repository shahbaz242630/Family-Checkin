import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import type { ChannelProvider, ChannelCallResult, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';
import { CHANNEL_PROVIDERS } from './channels.tokens';

@Injectable()
export class ChannelRouterService {
  private readonly providersByChannel: Map<Channel, ChannelProvider>;

  constructor(@Optional() @Inject(CHANNEL_PROVIDERS) providers: ChannelProvider[] = []) {
    this.providersByChannel = new Map(providers.map((provider) => [provider.channel, provider]));
  }

  async sendMessage(channel: Channel, to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    return this.providerFor(channel).sendMessage(to, message);
  }

  async makeVoiceCall(channel: Channel, to: string, script: VoiceScript): Promise<ChannelCallResult> {
    return this.providerFor(channel).makeVoiceCall(to, script);
  }

  async isAvailableForNumber(channel: Channel, phone: string): Promise<boolean> {
    return this.providerFor(channel).isAvailableForNumber(phone);
  }

  private providerFor(channel: Channel): ChannelProvider {
    const provider = this.providersByChannel.get(channel);

    if (!provider) {
      throw new Error(`No channel provider registered for ${channel}`);
    }

    return provider;
  }
}
