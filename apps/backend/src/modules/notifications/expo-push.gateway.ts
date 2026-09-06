import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound?: 'default' | string;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  interruptionLevel?: 'passive' | 'active' | 'timeSensitive' | 'critical';
}

/** Expo's answer to one message in a send request: accepted (with the id its receipt is filed under) or not. */
export interface ExpoPushTicket {
  ok: boolean;
  id?: string;
  error?: string;
}

/** What happened to an accepted message once Expo handed it to APNs/FCM; available about 15 minutes later. */
export interface ExpoPushReceipt {
  id: string;
  ok: boolean;
  error?: string;
}

export type PushGateway = (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>;

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo accepts at most 100 messages per send request. */
export const EXPO_PUSH_SEND_CHUNK_SIZE = 100;
/** Expo accepts up to 1000 receipt ids per request; a smaller batch keeps each request quick. */
export const EXPO_PUSH_RECEIPT_CHUNK_SIZE = 300;
/** Time budget for one request to Expo; a siren must not hang on a slow push service. */
export const EXPO_PUSH_TIMEOUT_MS = 10_000;
/** Ticket error for every message in a chunk whose request failed outright (timeout, 5xx, no tickets). */
export const EXPO_PUSH_REQUEST_FAILED = 'PushRequestFailed';
/** Receipt or ticket error that means the token is dead and must be deactivated. */
export const EXPO_DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

export interface ExpoPushGatewayOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sendChunkSize?: number;
  receiptChunkSize?: number;
}

interface ExpoTicketPayload {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceiptPayload {
  status?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoErrorPayload {
  code?: string;
  message?: string;
}

/**
 * The Expo push API client (CB-023): sends in chunks of 100 with a time limit per request, carries the optional
 * `EXPO_ACCESS_TOKEN` bearer, and fetches delivery receipts so `NotificationsService` can retire tokens whose
 * device is gone.
 */
@Injectable()
export class ExpoPushGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sendChunkSize: number;
  private readonly receiptChunkSize: number;

  constructor(
    @Optional()
    @Inject(AppConfigService)
    private readonly config?: Pick<AppConfigService, 'expoAccessToken'>,
    @Optional() options: ExpoPushGatewayOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? EXPO_PUSH_TIMEOUT_MS;
    this.sendChunkSize = options.sendChunkSize ?? EXPO_PUSH_SEND_CHUNK_SIZE;
    this.receiptChunkSize = options.receiptChunkSize ?? EXPO_PUSH_RECEIPT_CHUNK_SIZE;
  }

  /**
   * One ticket per message, in message order. A chunk whose request fails marks its messages
   * `PushRequestFailed` so the sends that did go out still count; when every chunk fails the error is thrown,
   * which is the caller's cue for the voice fallback.
   */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) {
      return [];
    }

    const chunks = chunk(messages, this.sendChunkSize);
    const tickets: ExpoPushTicket[] = [];
    let failedChunks = 0;
    let lastError: unknown;

    for (const batch of chunks) {
      try {
        tickets.push(...(await this.sendChunk(batch)));
      } catch (error) {
        failedChunks += 1;
        lastError = error;
        tickets.push(...batch.map(() => ({ ok: false, error: EXPO_PUSH_REQUEST_FAILED })));
      }
    }

    if (failedChunks === chunks.length) {
      throw lastError instanceof Error ? lastError : new Error('Expo push request failed');
    }

    return tickets;
  }

  /** Receipts for the given ticket ids; ids Expo has no receipt for yet are simply absent from the result. */
  async getReceipts(ticketIds: string[]): Promise<ExpoPushReceipt[]> {
    const receipts: ExpoPushReceipt[] = [];

    for (const ids of chunk(ticketIds, this.receiptChunkSize)) {
      const body = await this.post<{ data?: Record<string, ExpoReceiptPayload>; errors?: ExpoErrorPayload[] }>(
        EXPO_PUSH_RECEIPTS_URL,
        { ids },
      );
      if (!body.data || typeof body.data !== 'object') {
        throw new Error(`Expo push receipts request rejected: ${body.errors?.[0]?.code ?? 'no receipts returned'}`);
      }
      for (const [id, receipt] of Object.entries(body.data)) {
        receipts.push(toReceipt(id, receipt));
      }
    }

    return receipts;
  }

  private async sendChunk(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const body = await this.post<{ data?: ExpoTicketPayload[]; errors?: ExpoErrorPayload[] }>(
      EXPO_PUSH_SEND_URL,
      messages,
    );
    if (!Array.isArray(body.data)) {
      throw new Error(`Expo push request rejected: ${body.errors?.[0]?.code ?? 'no tickets returned'}`);
    }

    return messages.map((_, index) => toTicket(body.data?.[index]));
  }

  private async post<T>(url: string, payload: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const accessToken = this.config?.expoAccessToken;
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Expo push request failed with ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function toTicket(payload: ExpoTicketPayload | undefined): ExpoPushTicket {
  if (!payload) {
    return { ok: false, error: EXPO_PUSH_REQUEST_FAILED };
  }
  return payload.status === 'ok' && payload.id
    ? { ok: true, id: payload.id }
    : { ok: false, error: payload.details?.error ?? payload.message ?? 'ExpoPushError' };
}

function toReceipt(id: string, payload: ExpoReceiptPayload): ExpoPushReceipt {
  return payload.status === 'ok'
    ? { id, ok: true }
    : { id, ok: false, error: payload.details?.error ?? payload.message ?? 'ExpoPushError' };
}
