import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { errorLogFields } from '../../shared/logging';
import type {
  ChannelProvider,
  ChannelCallResult,
  ChannelSendResult,
  TemplatedMessage,
  VoiceCallOptions,
  VoiceScript,
} from './channel-provider';
import { CHANNEL_PROVIDERS } from './channels.tokens';

export interface ReachableChannelPlanInput {
  phone: string;
  primaryChannel: Channel;
  fallbackChannels: Channel[];
}

export interface ReachableChannelPlan {
  primaryChannel: Channel;
  fallbackChannels: Channel[];
  detectionStatus: 'PRIMARY_AVAILABLE' | 'FALLBACK_SELECTED' | 'MANUAL_REQUIRED';
  unavailableChannels: Channel[];
  detectionConfidence: 'provider_availability_check' | 'manual_selection';
}

@Injectable()
export class ChannelRouterService {
  private readonly logger = new Logger(ChannelRouterService.name);
  private readonly providersByChannel: Map<Channel, ChannelProvider>;

  constructor(@Optional() @Inject(CHANNEL_PROVIDERS) providers: ChannelProvider[] = []) {
    this.providersByChannel = new Map(providers.map((provider) => [provider.channel, provider]));
  }

  async sendMessage(channel: Channel, to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    return this.providerFor(channel).sendMessage(to, message);
  }

  async makeVoiceCall(
    channel: Channel,
    to: string,
    script: VoiceScript,
    options?: VoiceCallOptions,
  ): Promise<ChannelCallResult> {
    return this.providerFor(channel).makeVoiceCall(to, script, options);
  }

  async isAvailableForNumber(channel: Channel, phone: string): Promise<boolean> {
    return this.providerFor(channel).isAvailableForNumber(phone);
  }

  async resolveReachablePlan(input: ReachableChannelPlanInput): Promise<ReachableChannelPlan> {
    const channels = [input.primaryChannel, ...input.fallbackChannels].filter(
      (channel, index, all) => all.indexOf(channel) === index,
    );
    const unavailableChannels: Channel[] = [];

    for (const channel of channels) {
      try {
        if (await this.isAvailableForNumber(channel, input.phone)) {
          return {
            primaryChannel: channel,
            fallbackChannels: channels.filter(
              (candidate) => candidate !== channel && !unavailableChannels.includes(candidate),
            ),
            detectionStatus: channel === input.primaryChannel ? 'PRIMARY_AVAILABLE' : 'FALLBACK_SELECTED',
            unavailableChannels,
            detectionConfidence: 'provider_availability_check',
          };
        }
        unavailableChannels.push(channel);
      } catch (error) {
        // The phone number is deliberately absent from the line; the channel and the provider's error code are
        // enough to tell a rejected number from a Twilio outage (CB-047).
        this.logger.warn({
          message: 'Channel availability check failed; the plan falls back to manual selection',
          event: 'channel_router.availability_check_failed',
          channel,
          primaryChannel: input.primaryChannel,
          ...errorLogFields(error),
        });

        return {
          primaryChannel: input.primaryChannel,
          fallbackChannels: input.fallbackChannels,
          detectionStatus: 'MANUAL_REQUIRED',
          unavailableChannels,
          detectionConfidence: 'manual_selection',
        };
      }
    }

    return {
      primaryChannel: input.primaryChannel,
      fallbackChannels: input.fallbackChannels,
      detectionStatus: 'MANUAL_REQUIRED',
      unavailableChannels,
      detectionConfidence: 'manual_selection',
    };
  }

  private providerFor(channel: Channel): ChannelProvider {
    const provider = this.providersByChannel.get(channel);

    if (!provider) {
      throw new Error(`No channel provider registered for ${channel}`);
    }

    return provider;
  }
}
