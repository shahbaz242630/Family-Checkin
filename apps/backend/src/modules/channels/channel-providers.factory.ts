import { Channel } from '@prisma/client';
import { AppConfigService } from '../../shared/config/app-config.service';
import type { ChannelProvider } from './channel-provider';
import { FakeChannelProvider } from './fake-channel.provider';
import type { FakeOutboundSink } from './fake-outbound-recorder';
import { MessageCatalogService } from './message-catalog.service';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

/**
 * Builds the three channel providers for the current mode. `fakeOutboundRecorder` is only consulted in fake mode:
 * every fake provider reports its sends to it so the running backend can show them (CB-067). Configured
 * providers never see it, so nothing about a real send is ever copied into the recorder.
 */
export function createChannelProviders(
  config: AppConfigService,
  catalog: MessageCatalogService = new MessageCatalogService(),
  fakeOutboundRecorder?: FakeOutboundSink,
): ChannelProvider[] {
  if (config.channelProviderMode === 'fake') {
    const options = { catalog, recorder: fakeOutboundRecorder };
    return [
      new FakeChannelProvider(Channel.WHATSAPP, options),
      new FakeChannelProvider(Channel.SMS, options),
      new FakeChannelProvider(Channel.VOICE, options),
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
