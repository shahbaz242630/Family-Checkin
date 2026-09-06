import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import type { ChannelProvider } from './channel-provider';
import { FakeChannelProvider } from './fake-channel.provider';
import { MessageCatalogService } from './message-catalog.service';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

export function createChannelProviders(
  config: AppConfigService,
  catalog: MessageCatalogService = new MessageCatalogService(),
): ChannelProvider[] {
  if (config.channelProviderMode === 'fake') {
    return [
      new FakeChannelProvider(Channel.WHATSAPP, { catalog }),
      new FakeChannelProvider(Channel.SMS, { catalog }),
      new FakeChannelProvider(Channel.VOICE, { catalog }),
    ];
  }

  return [
    new WhatsappProvider({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromNumber: config.twilioWhatsappFromNumber,
      contentSidByTemplateKey: config.twilioWhatsappContentSids,
    }),
    new SmsProvider(
      {
        accountSid: config.twilioAccountSid,
        authToken: config.twilioAuthToken,
        fromNumber: config.twilioSmsFromNumber,
      },
      undefined,
      undefined,
      catalog,
    ),
    new VoiceProvider({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromNumber: config.twilioVoiceFromNumber,
      publicApiBaseUrl: config.publicApiBaseUrl,
      voiceAudioBaseUrl: config.voiceAudioBaseUrl,
    }),
  ];
}
