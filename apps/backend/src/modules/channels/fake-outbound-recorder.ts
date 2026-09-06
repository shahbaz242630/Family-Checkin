import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { FAKE_OUTBOUND_RECORDER_OPTIONS } from './channels.tokens';

/** A message the fake provider "sent": the rendered text a receiver, backup contact or sender would have read. */
export interface FakeOutboundMessageRecord {
  kind: 'message';
  /** ISO timestamp of the fake acceptance. */
  at: string;
  channel: Channel;
  to: string;
  providerMessageId: string;
  templateKey: string;
  language: string;
  fallback: boolean;
  body: string;
}

/** A voice call the fake provider "placed"; the script is not rendered to text, so the key and variables are kept. */
export interface FakeOutboundVoiceCallRecord {
  kind: 'voice_call';
  at: string;
  channel: Channel;
  to: string;
  providerCallId: string;
  scriptKey: string;
  language: string;
  variables: Record<string, string>;
  fromNumber?: string;
}

export type FakeOutboundRecord = FakeOutboundMessageRecord | FakeOutboundVoiceCallRecord;

/** What a `FakeChannelProvider` needs from a recorder; kept narrow so specs can pass a plain object. */
export interface FakeOutboundSink {
  record(record: FakeOutboundRecord): void;
}

export interface FakeOutboundRecorderOptions {
  /** How many records to keep; older ones are dropped. */
  capacity?: number;
  /** Where each formatted line goes. Defaults to the Nest logger, which prints to the backend terminal. */
  log?: (line: string) => void;
}

export const DEFAULT_FAKE_OUTBOUND_CAPACITY = 200;
export const DEFAULT_FAKE_OUTBOUND_LIST_LIMIT = 50;
export const FAKE_OUTBOUND_LOG_PREFIX = '[fake-provider]';

/** Last four digits only, so a terminal scrollback or a screenshot does not carry a whole phone number. */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? phone : `***${digits.slice(-4)}`;
}

export function formatFakeOutboundLine(record: FakeOutboundRecord): string {
  if (record.kind === 'message') {
    const rendering = record.fallback ? `${record.language}, english fallback` : record.language;
    return (
      `${FAKE_OUTBOUND_LOG_PREFIX} ${record.channel} message to ${maskPhoneForLog(record.to)} ` +
      `(${record.templateKey}, ${rendering}) ${record.providerMessageId}: ${JSON.stringify(record.body)}`
    );
  }

  return (
    `${FAKE_OUTBOUND_LOG_PREFIX} ${record.channel} call to ${maskPhoneForLog(record.to)} ` +
    `(${record.scriptKey}, ${record.language}) ${record.providerCallId} variables ${JSON.stringify(record.variables)}`
  );
}

/**
 * Keeps the last N fake sends in memory and prints each one as it happens (CB-067). Only fake providers write to
 * it, so in configured mode it stays empty, and the route that reads it exists only in fake mode
 * (`ReceiverRepliesModule`). This is a local-testing aid: the records carry the phone numbers and message bodies
 * that a real provider would have transmitted, which is exactly what an emulator session needs to see.
 */
@Injectable()
export class FakeOutboundRecorder implements FakeOutboundSink {
  private readonly records: FakeOutboundRecord[] = [];
  private readonly capacity: number;
  private readonly log: (line: string) => void;

  constructor(@Optional() @Inject(FAKE_OUTBOUND_RECORDER_OPTIONS) options?: FakeOutboundRecorderOptions) {
    this.capacity = Math.max(1, Math.floor(options?.capacity ?? DEFAULT_FAKE_OUTBOUND_CAPACITY));
    const logger = new Logger('FakeChannelProvider');
    this.log = options?.log ?? ((line) => logger.log(line));
  }

  record(record: FakeOutboundRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
    this.log(formatFakeOutboundLine(record));
  }

  /** Newest first, at most `limit` records. */
  recent(limit: number = DEFAULT_FAKE_OUTBOUND_LIST_LIMIT): FakeOutboundRecord[] {
    const count = Math.max(0, Math.floor(limit));
    return this.records.slice(Math.max(0, this.records.length - count)).reverse();
  }

  get size(): number {
    return this.records.length;
  }

  clear(): void {
    this.records.length = 0;
  }
}
