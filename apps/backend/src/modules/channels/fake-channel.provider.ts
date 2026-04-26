import type { Channel } from '@prisma/client';
import type { ChannelCallResult, ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from './channel-provider';

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
}

export class FakeChannelProvider implements ChannelProvider {
  public readonly sentMessages: SentFakeMessage[] = [];
  public readonly voiceCalls: FakeVoiceCall[] = [];

  private readonly availableNumbers: Set<string>;
  private readonly now: () => Date;

  constructor(
    public readonly channel: Channel,
    options: FakeChannelProviderOptions = {},
  ) {
    this.availableNumbers = new Set(options.availableNumbers ?? []);
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

  async makeVoiceCall(to: string, script: VoiceScript): Promise<ChannelCallResult> {
    this.voiceCalls.push({ to, script });

    return {
      providerCallId: `fake-${this.channel}-call-${this.voiceCalls.length}`,
      acceptedAt: this.now(),
      providerStatus: 'accepted',
    };
  }

  async isAvailableForNumber(phone: string): Promise<boolean> {
    return this.availableNumbers.has(phone);
  }
}
