import { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';

export interface WhatsappProviderConfig {
  accessToken?: string;
  phoneNumberId?: string;
}

export class WhatsappProvider implements ChannelProvider {
  public readonly channel = Channel.WHATSAPP;

  constructor(private readonly config: WhatsappProviderConfig) {}

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<ChannelSendResult> {
    this.assertConfigured();
    throw new Error('WhatsApp provider API integration is not implemented yet');
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    throw new Error('WhatsApp provider cannot make voice calls');
  }

  async isAvailableForNumber(_phone: string): Promise<boolean> {
    this.assertConfigured();
    throw new Error('WhatsApp availability lookup is not implemented yet');
  }

  private assertConfigured(): void {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      throw new ChannelProviderConfigurationError('WhatsApp');
    }
  }
}
