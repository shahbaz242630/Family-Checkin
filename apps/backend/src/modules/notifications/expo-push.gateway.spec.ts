import { describe, expect, it, vi } from 'vitest';
import {
  chunk,
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_REQUEST_FAILED,
  EXPO_PUSH_SEND_URL,
  ExpoPushGateway,
} from './expo-push.gateway';
import type { ExpoPushMessage } from './expo-push.gateway';

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

function message(index: number): ExpoPushMessage {
  return { to: `ExpoPushToken[${index}]`, title: 'Title', body: 'Body', data: { index: String(index) } };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** A fetch stand-in that records every request and answers with the queued responses, in order. */
function recordingFetch(answers: Array<Response | Error | ((request: RecordedRequest) => Promise<Response>)>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
      signal: init?.signal,
    };
    requests.push(request);
    const answer = answers.shift();
    if (!answer) {
      throw new Error('no more answers queued');
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return typeof answer === 'function' ? answer(request) : answer;
  });

  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

function ticketsFor(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ status: 'ok', id: `${prefix}-${index}` }));
}

describe('ExpoPushGateway.send (CB-023)', () => {
  it('sends 150 messages as two requests of 100 and 50 and returns the tickets in message order', async () => {
    const { fetchImpl, requests } = recordingFetch([
      jsonResponse(200, { data: ticketsFor(100, 'a') }),
      jsonResponse(200, { data: ticketsFor(50, 'b') }),
    ]);
    const gateway = new ExpoPushGateway(undefined, { fetchImpl });

    const tickets = await gateway.send(Array.from({ length: 150 }, (_, index) => message(index)));

    expect(requests.map((request) => request.url)).toEqual([EXPO_PUSH_SEND_URL, EXPO_PUSH_SEND_URL]);
    expect((requests[0]?.body as unknown[]).length).toBe(100);
    expect((requests[1]?.body as unknown[]).length).toBe(50);
    expect((requests[1]?.body as ExpoPushMessage[])[0]?.to).toBe('ExpoPushToken[100]');
    expect(tickets).toHaveLength(150);
    expect(tickets[0]).toEqual({ ok: true, id: 'a-0' });
    expect(tickets[99]).toEqual({ ok: true, id: 'a-99' });
    expect(tickets[100]).toEqual({ ok: true, id: 'b-0' });
    expect(tickets[149]).toEqual({ ok: true, id: 'b-49' });
  });

  it('sends the EXPO_ACCESS_TOKEN as a bearer when configured and no Authorization header otherwise', async () => {
    const withToken = recordingFetch([jsonResponse(200, { data: ticketsFor(1, 't') })]);
    const withoutToken = recordingFetch([jsonResponse(200, { data: ticketsFor(1, 't') })]);

    await new ExpoPushGateway({ expoAccessToken: 'expo-secret' }, { fetchImpl: withToken.fetchImpl }).send([
      message(0),
    ]);
    await new ExpoPushGateway({ expoAccessToken: undefined }, { fetchImpl: withoutToken.fetchImpl }).send([message(0)]);

    expect(withToken.requests[0]?.headers).toMatchObject({
      Authorization: 'Bearer expo-secret',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(withoutToken.requests[0]?.headers).not.toHaveProperty('Authorization');
  });

  it('attaches a timeout signal and rejects once it fires', async () => {
    const { fetchImpl, requests } = recordingFetch([
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason));
        }),
    ]);
    const gateway = new ExpoPushGateway(undefined, { fetchImpl, timeoutMs: 20 });

    const error = (await gateway.send([message(0)]).catch((caught: unknown) => caught)) as Error;

    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(error.name).toBe('TimeoutError');
  });

  it('maps rejected tickets to their Expo error and keeps the position of every message', async () => {
    const { fetchImpl } = recordingFetch([
      jsonResponse(200, {
        data: [
          { status: 'ok', id: 'ok-1' },
          { status: 'error', message: 'device gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big' },
        ],
      }),
    ]);

    const tickets = await new ExpoPushGateway(undefined, { fetchImpl }).send([message(0), message(1), message(2)]);

    expect(tickets).toEqual([
      { ok: true, id: 'ok-1' },
      { ok: false, error: 'DeviceNotRegistered' },
      { ok: false, error: 'too big' },
    ]);
  });

  it('marks only the failed chunk when another chunk went through', async () => {
    const { fetchImpl } = recordingFetch([jsonResponse(200, { data: ticketsFor(2, 'a') }), jsonResponse(502, {})]);
    const gateway = new ExpoPushGateway(undefined, { fetchImpl, sendChunkSize: 2 });

    const tickets = await gateway.send([message(0), message(1), message(2)]);

    expect(tickets).toEqual([
      { ok: true, id: 'a-0' },
      { ok: true, id: 'a-1' },
      { ok: false, error: EXPO_PUSH_REQUEST_FAILED },
    ]);
  });

  it('throws when every chunk fails, so the caller can fall back to a voice call', async () => {
    const { fetchImpl } = recordingFetch([jsonResponse(503, {}), jsonResponse(503, {})]);
    const gateway = new ExpoPushGateway(undefined, { fetchImpl, sendChunkSize: 1 });

    await expect(gateway.send([message(0), message(1)])).rejects.toThrow('Expo push request failed with 503');
  });

  it('treats a 200 without tickets (request-level errors) as a failed request', async () => {
    const { fetchImpl } = recordingFetch([
      jsonResponse(200, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed projects' }] }),
    ]);

    await expect(new ExpoPushGateway(undefined, { fetchImpl }).send([message(0)])).rejects.toThrow(
      'Expo push request rejected: PUSH_TOO_MANY_EXPERIENCE_IDS',
    );
  });

  it('sends nothing for an empty batch', async () => {
    const { fetchImpl, requests } = recordingFetch([]);

    await expect(new ExpoPushGateway(undefined, { fetchImpl }).send([])).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('ExpoPushGateway.getReceipts (CB-023)', () => {
  it('fetches receipts in chunks and maps ok and error receipts by ticket id', async () => {
    const { fetchImpl, requests } = recordingFetch([
      jsonResponse(200, {
        data: {
          'ticket-1': { status: 'ok' },
          'ticket-2': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        },
      }),
      jsonResponse(200, { data: { 'ticket-3': { status: 'error', message: 'rate' } } }),
    ]);
    const gateway = new ExpoPushGateway({ expoAccessToken: 'expo-secret' }, { fetchImpl, receiptChunkSize: 2 });

    const receipts = await gateway.getReceipts(['ticket-1', 'ticket-2', 'ticket-3']);

    expect(requests.map((request) => [request.url, request.body])).toEqual([
      [EXPO_PUSH_RECEIPTS_URL, { ids: ['ticket-1', 'ticket-2'] }],
      [EXPO_PUSH_RECEIPTS_URL, { ids: ['ticket-3'] }],
    ]);
    expect(requests[0]?.headers).toMatchObject({ Authorization: 'Bearer expo-secret' });
    expect(receipts).toEqual([
      { id: 'ticket-1', ok: true },
      { id: 'ticket-2', ok: false, error: 'DeviceNotRegistered' },
      { id: 'ticket-3', ok: false, error: 'rate' },
    ]);
  });

  it('leaves out ids Expo has no receipt for yet', async () => {
    const { fetchImpl } = recordingFetch([jsonResponse(200, { data: { 'ticket-1': { status: 'ok' } } })]);

    await expect(new ExpoPushGateway(undefined, { fetchImpl }).getReceipts(['ticket-1', 'ticket-9'])).resolves.toEqual([
      { id: 'ticket-1', ok: true },
    ]);
  });

  it('asks Expo nothing when there are no ids', async () => {
    const { fetchImpl, requests } = recordingFetch([]);

    await expect(new ExpoPushGateway(undefined, { fetchImpl }).getReceipts([])).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into batches of the given size, last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
