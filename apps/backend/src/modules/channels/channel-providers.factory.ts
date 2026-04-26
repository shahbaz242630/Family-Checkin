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
      accessToken: config.whatsappAccessToken,
      phoneNumberId: config.whatsappPhoneNumberId,
    }),
    new SmsProvider({
      apiKey: config.smsProviderApiKey,
      fromNumber: config.smsProviderFromNumber,
    }),
    new VoiceProvider({
      apiKey: config.voiceProviderApiKey,
      fromNumber: config.voiceProviderFromNumber,
    }),
  ];
}
