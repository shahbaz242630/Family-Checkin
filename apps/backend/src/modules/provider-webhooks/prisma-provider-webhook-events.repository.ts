import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CreateProviderWebhookEventIfAbsentResult,
  CreateProviderWebhookEventInput,
  ProviderWebhookEventKey,
  ProviderWebhookEventsRepository,
} from './provider-webhook-events.repository';

interface ProviderWebhookEventsPrismaWriter {
  checkInAttempt: {
    findFirst(args: {
      where: { providerMessageId: string };
      select: { id: true };
      orderBy: { sentAt: 'desc' };
    }): Promise<{ id: string } | null>;
  };
  providerWebhookEvent: {
    findFirst(args: {
      where: { provider: string; eventType: string; providerEventId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        provider: string;
        eventType: string;
        providerEventId?: string;
        providerMessageId?: string;
        checkInAttemptId?: string;
        payload: Record<string, string | undefined>;
        receivedAt: Date;
        processedAt: Date;
      };
    }): Promise<{ id: string }>;
  };
  providerWebhookEventKey: {
    /** `createMany` with `skipDuplicates` is Prisma's INSERT ... ON CONFLICT DO NOTHING; `count` is 0 on a replay. */
    createMany(args: { data: ProviderWebhookEventKey[]; skipDuplicates: true }): Promise<{ count: number }>;
  };
}

interface ProviderWebhookEventsPrismaClient extends ProviderWebhookEventsPrismaWriter {
  $transaction<T>(run: (tx: ProviderWebhookEventsPrismaWriter) => Promise<T>): Promise<T>;
}

@Injectable()
export class PrismaProviderWebhookEventsRepository implements ProviderWebhookEventsRepository {
  private readonly prisma: ProviderWebhookEventsPrismaClient;

  constructor(
    @Inject(PrismaService)
    prisma: ProviderWebhookEventsPrismaClient | PrismaService,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {
    this.prisma = prisma as ProviderWebhookEventsPrismaClient;
  }

  async createEvent(input: CreateProviderWebhookEventInput): Promise<{ id: string }> {
    return this.insertEvent(this.prisma, input);
  }

  async findEvent(key: ProviderWebhookEventKey): Promise<{ id: string } | null> {
    return this.prisma.providerWebhookEvent.findFirst({ where: key, select: { id: true } });
  }

  /**
   * The natural key is claimed in `provider_webhook_event_keys` (composite primary key, so a real unique index)
   * and the event row is written in the same transaction: a concurrent duplicate loses the key insert and stores
   * nothing, and a failure after the claim rolls the claim back so the provider's retry is not mistaken for a
   * replay. The partitioned events table itself cannot carry this index (CB-016).
   */
  async createEventIfAbsent(input: CreateProviderWebhookEventInput): Promise<CreateProviderWebhookEventIfAbsentResult> {
    const providerEventId = input.providerEventId;
    if (!providerEventId) {
      const created = await this.createEvent(input);
      return { id: created.id, created: true };
    }

    const key: ProviderWebhookEventKey = { provider: input.provider, eventType: input.eventType, providerEventId };
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.providerWebhookEventKey.createMany({ data: [key], skipDuplicates: true });
      if (claimed.count === 0) {
        const existing = await tx.providerWebhookEvent.findFirst({ where: key, select: { id: true } });
        return { ...(existing ? { id: existing.id } : {}), created: false };
      }

      const created = await this.insertEvent(tx, input);
      return { id: created.id, created: true };
    });
  }

  private async insertEvent(
    writer: ProviderWebhookEventsPrismaWriter,
    input: CreateProviderWebhookEventInput,
  ): Promise<{ id: string }> {
    const receivedAt = this.now();
    const attempt = input.providerMessageId
      ? await writer.checkInAttempt.findFirst({
          where: { providerMessageId: input.providerMessageId },
          select: { id: true },
          orderBy: { sentAt: 'desc' },
        })
      : null;

    return writer.providerWebhookEvent.create({
      data: {
        provider: input.provider,
        eventType: input.eventType,
        providerEventId: input.providerEventId,
        providerMessageId: input.providerMessageId,
        checkInAttemptId: attempt?.id,
        payload: input.payload,
        receivedAt,
        processedAt: receivedAt,
      },
    });
  }
}
