import type { Channel } from '@prisma/client';
import type {
  ChannelCallResult,
  ChannelProvider,
  ChannelSendResult,
  TemplatedMessage,
  VoiceCallOptions,
  VoiceScript,
} from './channel-provider';
import { MessageCatalogService } from './message-catalog.service';

export interface FakeChannelProviderOptions {
  availableNumbers?: string[];
  now?: () => Date;
  /** Defaults to the in-code catalog so fake sends fail on a missing variable exactly like a real send. */
  catalog?: MessageCatalogService;
}

export interface SentFakeMessage {
  to: string;
  message: TemplatedMessage;
}

/** The text a real provider would have sent for the matching `sentMessages` entry. */
export interface RenderedFakeMessage {
  to: string;
  templateKey: string;
  body: string;
  language: string;
  fallback: boolean;
}

export interface FakeVoiceCall {
  to: string;
  script: VoiceScript;
  options?: VoiceCallOptions;
}

export class FakeChannelProvider implements ChannelProvider {
  public readonly sentMessages: SentFakeMessage[] = [];
  public readonly renderedMessages: RenderedFakeMessage[] = [];
  public readonly voiceCalls: FakeVoiceCall[] = [];

  private readonly availableNumbers?: Set<string>;
  private readonly now: () => Date;
  private readonly catalog: MessageCatalogService;

  constructor(
    public readonly channel: Channel,
    options: FakeChannelProviderOptions = {},
  ) {
    this.availableNumbers = options.availableNumbers ? new Set(options.availableNumbers) : undefined;
    this.now = options.now ?? (() => new Date());
    this.catalog = options.catalog ?? new MessageCatalogService();
  }

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    const rendered = await this.catalog.render({ ...message, channel: this.channel });
    this.sentMessages.push({ to, message });
    this.renderedMessages.push({ to, templateKey: message.templateKey, ...rendered });

    return {
      providerMessageId: `fake-${this.channel}-message-${this.sentMessages.length}`,
      acceptedAt: this.now(),
      providerStatus: 'accepted',
      rendering: { language: rendered.language, fallback: rendered.fallback },
    };
  }

  async makeVoiceCall(to: string, script: VoiceScript, options?: VoiceCallOptions): Promise<ChannelCallResult> {
    this.voiceCalls.push({ to, script, options });

    return {
      providerCallId: `fake-${this.channel}-call-${this.voiceCalls.length}`,
      acceptedAt: this.now(),
      providerStatus: 'accepted',
    };
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return this.availableNumbers ? this.availableNumbers.has(phone) : /^\+[1-9]\d{7,14}$/.test(phone);
  }
}
