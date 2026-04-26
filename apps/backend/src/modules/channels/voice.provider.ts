import { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';

export interface VoiceProviderConfig {
  apiKey?: string;
  fromNumber?: string;
}

export class VoiceProvider implements ChannelProvider {
  public readonly channel = Channel.VOICE;

  constructor(private readonly config: VoiceProviderConfig) {}

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<ChannelSendResult> {
    throw new Error('Voice provider cannot send text messages');
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    this.assertConfigured();
    throw new Error('Voice provider API integration is not implemented yet');
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  private assertConfigured(): void {
    if (!this.config.apiKey || !this.config.fromNumber) {
      throw new ChannelProviderConfigurationError('Voice');
    }
  }
}
