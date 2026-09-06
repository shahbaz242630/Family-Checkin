import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CreateProviderWebhookEventInput,
  ProviderWebhookEventKey,
  ProviderWebhookEventsRepository,
} from './provider-webhook-events.repository';

interface ProviderWebhookEventsPrismaClient {
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
}

@Injectable()
export class PrismaProviderWebhookEventsRepository implements ProviderWebhookEventsRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProviderWebhookEventsPrismaClient | PrismaService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createEvent(input: CreateProviderWebhookEventInput): Promise<{ id: string }> {
    const receivedAt = this.now();
    const attempt = input.providerMessageId
      ? await this.prisma.checkInAttempt.findFirst({
          where: { providerMessageId: input.providerMessageId },
          select: { id: true },
          orderBy: { sentAt: 'desc' },
        })
      : null;

    return await this.prisma.providerWebhookEvent.create({
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

  // The dedupe index is non-unique until CB-016 restores it, so a concurrent duplicate can still slip past this
  // check; it closes the retry/replay window that matters in practice.
  async findEvent(key: ProviderWebhookEventKey): Promise<{ id: string } | null> {
    return this.prisma.providerWebhookEvent.findFirst({ where: key, select: { id: true } });
  }

  async createEventIfAbsent(input: CreateProviderWebhookEventInput): Promise<{ id: string; created: boolean }> {
    if (input.providerEventId) {
      const existing = await this.findEvent({
        provider: input.provider,
        eventType: input.eventType,
        providerEventId: input.providerEventId,
      });
      if (existing) {
        return { id: existing.id, created: false };
      }
    }

    const created = await this.createEvent(input);
    return { id: created.id, created: true };
  }
}
