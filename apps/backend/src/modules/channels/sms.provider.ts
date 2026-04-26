import { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';

export interface SmsProviderConfig {
  apiKey?: string;
  fromNumber?: string;
}

export class SmsProvider implements ChannelProvider {
  public readonly channel = Channel.SMS;

  constructor(private readonly config: SmsProviderConfig) {}

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<ChannelSendResult> {
    this.assertConfigured();
    throw new Error('SMS provider API integration is not implemented yet');
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    throw new Error('SMS provider cannot make voice calls');
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  private assertConfigured(): void {
    if (!this.config.apiKey || !this.config.fromNumber) {
      throw new ChannelProviderConfigurationError('SMS');
    }
  }
}
