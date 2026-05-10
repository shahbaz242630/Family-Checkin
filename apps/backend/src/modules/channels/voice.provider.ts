import { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceCallOptions, VoiceScript } from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';
import { FetchTwilioHttpClient, type TwilioHttpClient } from './twilio-http-client';
import { renderTwilioVoiceTwiml } from './twilio-rendering';

export interface VoiceProviderConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  publicApiBaseUrl?: string;
  voiceAudioBaseUrl?: string;
}

export class VoiceProvider implements ChannelProvider {
  public readonly channel = Channel.VOICE;

  constructor(
    private readonly config: VoiceProviderConfig,
    private readonly httpClient: TwilioHttpClient = new FetchTwilioHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<ChannelSendResult> {
    throw new Error('Voice provider cannot send text messages');
  }

  async makeVoiceCall(to: string, script: VoiceScript, options?: VoiceCallOptions): Promise<ChannelCallResult> {
    const config = this.configured();

    const publicApiBaseUrl = stripTrailingSlash(config.publicApiBaseUrl);
    const voiceAudioBaseUrl = stripTrailingSlash(config.voiceAudioBaseUrl);
    const response = await this.httpClient.postForm(
      this.callsUrl(config.accountSid),
      new URLSearchParams({
        To: to,
        From: options?.fromNumber ?? config.fromNumber,
        Twiml: renderTwilioVoiceTwiml(script, {
          actionUrl: `${publicApiBaseUrl}/provider-webhooks/twilio/voice`,
          audioBaseUrl: voiceAudioBaseUrl,
        }),
        MachineDetection: 'Enable',
        AsyncAmd: 'true',
        AsyncAmdStatusCallback: `${publicApiBaseUrl}/provider-webhooks/twilio/voice/amd`,
        AsyncAmdStatusCallbackMethod: 'POST',
        StatusCallback: `${publicApiBaseUrl}/provider-webhooks/twilio/voice/status`,
        StatusCallbackEvent: 'initiated ringing answered completed',
        StatusCallbackMethod: 'POST',
      }),
      config.authToken,
    );

    return {
      providerCallId: stringFrom(response.sid, 'unknown-twilio-call'),
      acceptedAt: this.now(),
      providerStatus: toCallStatus(response.status),
    };
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  private assertConfigured(): void {
    if (
      !this.config.accountSid ||
      !this.config.authToken ||
      !this.config.fromNumber ||
      !this.config.publicApiBaseUrl ||
      !this.config.voiceAudioBaseUrl
    ) {
      throw new ChannelProviderConfigurationError('Voice');
    }
  }

  private configured(): Required<VoiceProviderConfig> {
    this.assertConfigured();
    return this.config as Required<VoiceProviderConfig>;
  }

  private callsUrl(accountSid: string): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
  }
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toCallStatus(value: unknown): ChannelCallResult['providerStatus'] {
  if (value === 'queued') {
    return 'queued';
  }
  if (value === 'ringing') {
    return 'ringing';
  }
  return 'accepted';
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
