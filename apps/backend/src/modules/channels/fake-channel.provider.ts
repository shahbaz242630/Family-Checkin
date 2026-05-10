import type { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceCallOptions, VoiceScript } from './channel-provider';

export interface FakeChannelProviderOptions {
  availableNumbers?: string[];
  now?: () => Date;
}

export interface SentFakeMessage {
  to: string;
  message: TemplatedMessage;
}

export interface FakeVoiceCall {
  to: string;
  script: VoiceScript;
  options?: VoiceCallOptions;
}

export class FakeChannelProvider implements ChannelProvider {
  public readonly sentMessages: SentFakeMessage[] = [];
  public readonly voiceCalls: FakeVoiceCall[] = [];

  private readonly availableNumbers?: Set<string>;
  private readonly now: () => Date;

  constructor(
    public readonly channel: Channel,
    options: FakeChannelProviderOptions = {},
  ) {
    this.availableNumbers = options.availableNumbers ? new Set(options.availableNumbers) : undefined;
    this.now = options.now ?? (() => new Date());
  }

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    this.sentMessages.push({ to, message });

    return {
      providerMessageId: `fake-${this.channel}-message-${this.sentMessages.length}`,
      acceptedAt: this.now(),
      providerStatus: 'accepted',
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
