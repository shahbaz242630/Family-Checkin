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
    expect(prisma.providerWebhookEvent.findFirstCalls).toEqual([
      {
        where: { provider: 'twilio', eventType: 'messaging_inbound', providerEventId: 'SM123' },
        select: { id: true },
      },
    ]);
    expect(prisma.providerWebhookEvent.createCalls).toEqual([]);
  });

  it('stores a first-seen provider event id and reports it as created', async () => {
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
    expect(prisma.providerWebhookEvent.findFirstCalls).toHaveLength(1);
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
  });

  it('stores events that carry no provider event id without a duplicate lookup', async () => {
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
    expect(prisma.providerWebhookEvent.findFirstCalls).toEqual([]);
    expect(prisma.providerWebhookEvent.createCalls).toHaveLength(1);
  });
});

class FakePrismaClient {
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
        return this.existingEvent;
      },
      createCalls: [],
      create: async (args: { data: Record<string, unknown> }) => {
        this.providerWebhookEvent.createCalls.push(args);
        return { id: 'event-1' };
      },
    };
  }
}
