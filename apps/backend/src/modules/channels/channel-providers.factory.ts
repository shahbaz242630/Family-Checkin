import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import type { ChannelProvider } from './channel-provider';
import { FakeChannelProvider } from './fake-channel.provider';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

export function createChannelProviders(config: AppConfigService): ChannelProvider[] {
  if (config.channelProviderMode === 'fake') {
    return [
      new FakeChannelProvider(Channel.WHATSAPP),
      new FakeChannelProvider(Channel.SMS),
      new FakeChannelProvider(Channel.VOICE),
    ];
  }

  return [
    new WhatsappProvider({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromNumber: config.twilioWhatsappFromNumber,
    }),
    new SmsProvider({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromNumber: config.twilioSmsFromNumber,
    }),
    new VoiceProvider({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromNumber: config.twilioVoiceFromNumber,
      publicApiBaseUrl: config.publicApiBaseUrl,
    }),
  ];
}
