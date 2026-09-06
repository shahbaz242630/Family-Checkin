import { Channel } from '@prisma/client';
import type {
  ChannelCallResult,
  ChannelProvider,
  ChannelSendResult,
  TemplatedMessage,
  VoiceScript,
} from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';
import { FetchTwilioHttpClient, type TwilioHttpClient } from './twilio-http-client';
import { renderTwilioMessage } from './twilio-rendering';

export interface SmsProviderConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

export class SmsProvider implements ChannelProvider {
  public readonly channel = Channel.SMS;

  constructor(
    private readonly config: SmsProviderConfig,
    private readonly httpClient: TwilioHttpClient = new FetchTwilioHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    const config = this.configured();

    const response = await this.httpClient.postForm(
      this.messagesUrl(config.accountSid),
      new URLSearchParams({
        To: to,
        From: config.fromNumber,
        Body: renderTwilioMessage(message),
      }),
      config.authToken,
    );

    return {
      providerMessageId: stringFrom(response.sid, 'unknown-twilio-message'),
      acceptedAt: this.now(),
      providerStatus: toMessageStatus(response.status),
    };
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    throw new Error('SMS provider cannot make voice calls');
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  private assertConfigured(): void {
    if (!this.config.accountSid || !this.config.authToken || !this.config.fromNumber) {
      throw new ChannelProviderConfigurationError('SMS');
    }
  }

  private configured(): Required<SmsProviderConfig> {
    this.assertConfigured();
    return this.config as Required<SmsProviderConfig>;
  }

  private messagesUrl(accountSid: string): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  }
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function toMessageStatus(value: unknown): ChannelSendResult['providerStatus'] {
  if (value === 'sent') {
    return 'sent';
  }
  if (value === 'queued') {
    return 'queued';
  }
  return 'accepted';
}
