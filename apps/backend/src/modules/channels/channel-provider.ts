import type { Channel } from '@prisma/client';
import type { MessageRendering } from './message-catalog.service';

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
  /** Present when the provider rendered the body itself (SMS, fake); absent for provider-side templates. */
  rendering?: MessageRendering;
}

export interface ChannelCallResult {
  providerCallId: string;
  acceptedAt: Date;
  providerStatus: 'accepted' | 'queued' | 'ringing';
}

export interface VoiceCallOptions {
  fromNumber?: string;
}

export interface ChannelProvider {
  readonly channel: Channel;
  sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult>;
  makeVoiceCall(to: string, script: VoiceScript, options?: VoiceCallOptions): Promise<ChannelCallResult>;
  isAvailableForNumber(phone: string): Promise<boolean>;
}
