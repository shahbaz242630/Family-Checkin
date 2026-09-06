import { describe, expect, it } from 'vitest';
import { PrismaProviderWebhookEventsRepository } from './prisma-provider-webhook-events.repository';

describe('PrismaProviderWebhookEventsRepository', () => {
  it('links provider events to the matching check-in attempt by provider message id', async () => {
    const prisma = new FakePrismaClient();
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:30:00.000Z'),
    );

    await repository.createEvent({
      provider: 'twilio',
      eventType: 'voice_status',
      providerEventId: 'CA123:completed',
      providerMessageId: 'CA123',
      payload: {
        CallSid: 'CA123',
        CallStatus: 'completed',
      },
    });

    expect(prisma.providerWebhookEvent.createCalls).toEqual([
      {
        data: {
          provider: 'twilio',
          eventType: 'voice_status',
          providerEventId: 'CA123:completed',
          providerMessageId: 'CA123',
          checkInAttemptId: 'attempt-1',
          payload: {
            CallSid: 'CA123',
            CallStatus: 'completed',
          },
          receivedAt: new Date('2026-05-10T18:30:00.000Z'),
          processedAt: new Date('2026-05-10T18:30:00.000Z'),
        },
      },
    ]);
  });

  it('stores provider events even when no matching attempt exists yet', async () => {
    const prisma = new FakePrismaClient(null);
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:31:00.000Z'),
    );

    await repository.createEvent({
      provider: 'twilio',
      eventType: 'voice_amd',
      providerEventId: 'CA124:unknown',
      providerMessageId: 'CA124',
      payload: {
        CallSid: 'CA124',
        AnsweredBy: 'unknown',
      },
    });

    expect(prisma.providerWebhookEvent.createCalls[0]?.data.checkInAttemptId).toBeUndefined();
  });

  it('returns the stored event instead of inserting a replayed provider event id', async () => {
    const prisma = new FakePrismaClient(null, { id: 'event-existing' });
    prisma.providerWebhookEventKey.claimed.add('twilio|messaging_inbound|SM123');
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:32:00.000Z'),
    );

    const result = await repository.createEventIfAbsent({
      provider: 'twilio',
      eventType: 'messaging_inbound',
      providerEventId: 'SM123',
      providerMessageId: 'SM123',
      payload: { MessageSid: 'SM123', channel: 'sms', bodyLength: '2', hasButtonPayload: 'false' },
    });

    expect(result).toEqual({ id: 'event-existing', created: false });
    expect(prisma.providerWebhookEventKey.createManyCalls).toEqual([
      {
        data: [{ provider: 'twilio', eventType: 'messaging_inbound', providerEventId: 'SM123' }],
        skipDuplicates: true,
      },
    ]);
    expect(prisma.providerWebhookEvent.findFirstCalls).toEqual([
      {
        where: { provider: 'twilio', eventType: 'messaging_inbound', providerEventId: 'SM123' },
        select: { id: true },
      },
    ]);
    expect(prisma.providerWebhookEvent.createCalls).toEqual([]);
    expect(prisma.transactions).toBe(1);
  });

  it('claims the natural key and stores a first-seen provider event in one transaction (CB-016)', async () => {
    const prisma = new FakePrismaClient(null, null);
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:33:00.000Z'),
    );

    const result = await repository.createEventIfAbsent({
      provider: 'twilio',
      eventType: 'messaging_inbound',
      providerEventId: 'SM124',
      providerMessageId: 'SM124',
      payload: { MessageSid: 'SM124', channel: 'whatsapp', bodyLength: '2', hasButtonPayload: 'true' },
    });

    expect(result).toEqual({ id: 'event-1', created: true });
    expect(prisma.providerWebhookEventKey.claimed.has('twilio|messaging_inbound|SM124')).toBe(true);
    // The key insert decides; no read-before-write is needed once the key is unique at the database.
    expect(prisma.providerWebhookEvent.findFirstCalls).toEqual([]);
    expect(prisma.providerWebhookEvent.createCalls).toEqual([
      {
        data: {
          provider: 'twilio',
          eventType: 'messaging_inbound',
          providerEventId: 'SM124',
          providerMessageId: 'SM124',
          checkInAttemptId: undefined,
          payload: { MessageSid: 'SM124', channel: 'whatsapp', bodyLength: '2', hasButtonPayload: 'true' },
          receivedAt: new Date('2026-05-10T18:33:00.000Z'),
          processedAt: new Date('2026-05-10T18:33:00.000Z'),
        },
      },
    ]);
    expect(prisma.transactions).toBe(1);
  });

  it('stores the same provider event once when it is delivered twice, and reports the replay as not created', async () => {
    const prisma = new FakePrismaClient(null, null);
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:35:00.000Z'),
    );
    const status = {
      provider: 'twilio',
      eventType: 'messaging_status',
      providerEventId: 'SM125:undelivered',
      providerMessageId: 'SM125',
      payload: { MessageSid: 'SM125', MessageStatus: 'undelivered', ErrorCode: '30003', channel: 'sms' },
    };

    const first = await repository.createEventIfAbsent(status);
    const replay = await repository.createEventIfAbsent(status);

    expect(first).toEqual({ id: 'event-1', created: true });
    expect(replay).toEqual({ id: 'event-1', created: false });
    expect(prisma.providerWebhookEvent.createCalls).toHaveLength(1);
  });

  it('stores events that carry no provider event id without claiming a key', async () => {
    const prisma = new FakePrismaClient(null, { id: 'event-existing' });
    const repository = new PrismaProviderWebhookEventsRepository(
      prisma as never,
      () => new Date('2026-05-10T18:34:00.000Z'),
    );

    const result = await repository.createEventIfAbsent({
      provider: 'twilio',
      eventType: 'messaging_inbound',
      payload: { MessageSid: undefined, channel: 'sms', bodyLength: '2', hasButtonPayload: 'false' },
    });

    expect(result).toEqual({ id: 'event-1', created: true });
    expect(prisma.providerWebhookEventKey.createManyCalls).toEqual([]);
    expect(prisma.providerWebhookEvent.findFirstCalls).toEqual([]);
    expect(prisma.providerWebhookEvent.createCalls).toHaveLength(1);
    expect(prisma.transactions).toBe(0);
  });
});

class FakePrismaClient {
  public transactions = 0;
  public checkInAttempt: {
    findFirstCalls: unknown[];
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  public providerWebhookEvent: {
    findFirstCalls: unknown[];
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    createCalls: Array<{ data: Record<string, unknown> }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  /** The composite primary key of provider_webhook_event_keys: `provider|eventType|providerEventId`. */
  public providerWebhookEventKey: {
    claimed: Set<string>;
    createManyCalls: unknown[];
    createMany: (args: {
      data: Array<{ provider: string; eventType: string; providerEventId: string }>;
      skipDuplicates: true;
    }) => Promise<{ count: number }>;
  };

  constructor(
    private readonly matchingAttempt: { id: string } | null = { id: 'attempt-1' },
    private readonly existingEvent: { id: string } | null = null,
  ) {
    this.checkInAttempt = {
      findFirstCalls: [],
      findFirst: async (args: unknown) => {
        this.checkInAttempt.findFirstCalls.push(args);
        return this.matchingAttempt;
      },
    };
    this.providerWebhookEvent = {
      findFirstCalls: [],
      findFirst: async (args: unknown) => {
        this.providerWebhookEvent.findFirstCalls.push(args);
        if (this.existingEvent) {
          return this.existingEvent;
        }
        return this.providerWebhookEvent.createCalls.length > 0 ? { id: 'event-1' } : null;
      },
      createCalls: [],
      create: async (args: { data: Record<string, unknown> }) => {
        this.providerWebhookEvent.createCalls.push(args);
        return { id: `event-${this.providerWebhookEvent.createCalls.length}` };
      },
    };
    this.providerWebhookEventKey = {
      claimed: new Set(),
      createManyCalls: [],
      createMany: async (args) => {
        this.providerWebhookEventKey.createManyCalls.push(args);
        let count = 0;
        for (const key of args.data) {
          const id = `${key.provider}|${key.eventType}|${key.providerEventId}`;
          if (!this.providerWebhookEventKey.claimed.has(id)) {
            this.providerWebhookEventKey.claimed.add(id);
            count += 1;
          }
        }
        return { count };
      },
    };
  }

  async $transaction<T>(run: (tx: this) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return run(this);
  }
}
