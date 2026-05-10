import { describe, expect, it } from 'vitest';
import { PrismaProviderWebhookEventsRepository } from './prisma-provider-webhook-events.repository';

describe('PrismaProviderWebhookEventsRepository', () => {
  it('links provider events to the matching check-in attempt by provider message id', async () => {
    const prisma = new FakePrismaClient();
    const repository = new PrismaProviderWebhookEventsRepository(prisma as never, () => new Date('2026-05-10T18:30:00.000Z'));

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
    const repository = new PrismaProviderWebhookEventsRepository(prisma as never, () => new Date('2026-05-10T18:31:00.000Z'));

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
});

class FakePrismaClient {
  public checkInAttempt: {
    findFirstCalls: unknown[];
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  public providerWebhookEvent: {
    createCalls: Array<{ data: Record<string, unknown> }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };

  constructor(private readonly matchingAttempt: { id: string } | null = { id: 'attempt-1' }) {
    this.checkInAttempt = {
      findFirstCalls: [],
      findFirst: async (args: unknown) => {
        this.checkInAttempt.findFirstCalls.push(args);
        return this.matchingAttempt;
      },
    };
    this.providerWebhookEvent = {
      createCalls: [],
      create: async (args: { data: Record<string, unknown> }) => {
        this.providerWebhookEvent.createCalls.push(args);
        return { id: 'event-1' };
      },
    };
  }
}
