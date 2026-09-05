import { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';
import { ChannelProviderConfigurationError } from './configured-provider-errors';
import { FetchTwilioHttpClient, type TwilioHttpClient } from './twilio-http-client';

export interface WhatsappProviderConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  contentSidByTemplateKey?: Record<string, string>;
}

export class WhatsappProvider implements ChannelProvider {
  public readonly channel = Channel.WHATSAPP;

  constructor(
    private readonly config: WhatsappProviderConfig,
    private readonly httpClient: TwilioHttpClient = new FetchTwilioHttpClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    const config = this.configured();
    const contentSid = this.contentSidForMessage(message, config.contentSidByTemplateKey);

    const response = await this.httpClient.postForm(
      this.messagesUrl(config.accountSid),
      new URLSearchParams({
        To: this.whatsappAddress(to),
        From: this.whatsappAddress(config.fromNumber),
        ContentSid: contentSid,
        ContentVariables: JSON.stringify(message.variables),
      }),
      config.authToken,
    );

    return {
      providerMessageId: stringFrom(response.sid, 'unknown-twilio-whatsapp-message'),
      acceptedAt: this.now(),
      providerStatus: toMessageStatus(response.status),
    };
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<ChannelCallResult> {
    throw new Error('WhatsApp provider cannot make voice calls');
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    this.assertConfigured();
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }

  private assertConfigured(): void {
    if (!this.config.accountSid || !this.config.authToken || !this.config.fromNumber || !this.config.contentSidByTemplateKey) {
      throw new ChannelProviderConfigurationError('WhatsApp');
    }
  }

  private configured(): Required<WhatsappProviderConfig> {
    this.assertConfigured();
    return this.config as Required<WhatsappProviderConfig>;
  }

  private messagesUrl(accountSid: string): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  }

  private whatsappAddress(phone: string): string {
    return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  }

  private contentSidForMessage(message: TemplatedMessage, contentSidByTemplateKey: Record<string, string>): string {
    const languageSpecificKey = `${message.templateKey}:${message.language}`;
    const contentSid = contentSidByTemplateKey[languageSpecificKey] ?? contentSidByTemplateKey[message.templateKey];
    if (!contentSid) {
      throw new Error(`WhatsApp content template is not configured for ${languageSpecificKey}`);
    }

    return contentSid;
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
