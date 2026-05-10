import { Inject, Injectable } from '@nestjs/common';
import { VoiceCallerIdStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ResolveVoiceCallerIdInput, VoiceCallerIdRepository } from './voice-caller-id.repository';

interface VoiceCallerIdPrismaClient {
  receiverVoiceCallerIdAssignment: {
    findFirst(args: {
      where: {
        receiverId: string;
        releasedAt: null;
        callerIdPool: { status: VoiceCallerIdStatus };
      };
      include: { callerIdPool: true };
    }): Promise<{ callerIdPool: { phoneNumber: string } } | null>;
    create(args: { data: { receiverId: string; callerIdPoolId: string } }): Promise<unknown>;
  };
  voiceCallerIdPool: {
    findFirst(args: {
      where: {
        countryCode: string;
        status: VoiceCallerIdStatus;
      };
      orderBy: Array<{ assignedCount?: 'asc' } | { lastAssignedAt?: 'asc' } | { createdAt?: 'asc' }>;
    }): Promise<{ id: string; phoneNumber: string } | null>;
    update(args: { where: { id: string }; data: { assignedCount: { increment: number }; lastAssignedAt: Date } }): Promise<unknown>;
  };
}

@Injectable()
export class PrismaVoiceCallerIdRepository implements VoiceCallerIdRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: VoiceCallerIdPrismaClient | PrismaService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolveForReceiver(input: ResolveVoiceCallerIdInput): Promise<string | undefined> {
    const existing = await this.prisma.receiverVoiceCallerIdAssignment.findFirst({
      where: {
        receiverId: input.receiverId,
        releasedAt: null,
        callerIdPool: { status: VoiceCallerIdStatus.ACTIVE },
      },
      include: { callerIdPool: true },
    });
    if (existing) {
      return existing.callerIdPool.phoneNumber;
    }

    const selected = await this.prisma.voiceCallerIdPool.findFirst({
      where: {
        countryCode: input.countryCode,
        status: VoiceCallerIdStatus.ACTIVE,
      },
      orderBy: [{ assignedCount: 'asc' }, { lastAssignedAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!selected) {
      return undefined;
    }

    await this.prisma.receiverVoiceCallerIdAssignment.create({
      data: {
        receiverId: input.receiverId,
        callerIdPoolId: selected.id,
      },
    });
    await this.prisma.voiceCallerIdPool.update({
      where: { id: selected.id },
      data: {
        assignedCount: { increment: 1 },
        lastAssignedAt: this.now(),
      },
    });

    return selected.phoneNumber;
  }
}
