import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { CreateProviderWebhookEventInput, ProviderWebhookEventsRepository } from './provider-webhook-events.repository';

interface ProviderWebhookEventsPrismaClient {
  checkInAttempt: {
    findFirst(args: {
      where: { providerMessageId: string };
      select: { id: true };
      orderBy: { sentAt: 'desc' };
    }): Promise<{ id: string } | null>;
  };
  providerWebhookEvent: {
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
}
