import type { Channel } from '@prisma/client';

export interface TemplatedMessage {
  templateKey: string;
  language: string;
  variables: Record<string, string>;
}

export interface VoiceScript {
  scriptKey: string;
  language: string;
  variables: Record<string, string>;
}

export interface ChannelSendResult {
  providerMessageId: string;
  acceptedAt: Date;
  providerStatus: 'accepted' | 'queued' | 'sent';
}

export interface ChannelCallResult {
  providerCallId: string;
  acceptedAt: Date;
  providerStatus: 'accepted' | 'queued' | 'ringing';
}

export interface ChannelProvider {
  readonly channel: Channel;
  sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult>;
  makeVoiceCall(to: string, script: VoiceScript): Promise<ChannelCallResult>;
  isAvailableForNumber(phone: string): Promise<boolean>;
}
