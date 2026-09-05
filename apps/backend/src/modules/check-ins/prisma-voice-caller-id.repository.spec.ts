import { VoiceCallerIdStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaVoiceCallerIdRepository } from './prisma-voice-caller-id.repository';

describe('PrismaVoiceCallerIdRepository', () => {
  it('reuses an active sticky caller ID assignment for the receiver', async () => {
    const prisma = new FakePrismaVoiceCallerIdClient({
      existingAssignment: { callerIdPool: { phoneNumber: '+15550001111' } },
    });
    const repository = new PrismaVoiceCallerIdRepository(prisma as never);

    await expect(repository.resolveForReceiver({ receiverId: 'receiver-1', countryCode: 'AE' })).resolves.toBe('+15550001111');

    expect(prisma.voiceCallerIdPool.findFirstCalls).toEqual([]);
    expect(prisma.receiverVoiceCallerIdAssignment.createCalls).toEqual([]);
  });

  it('assigns the least-used active caller ID when the receiver has no sticky assignment', async () => {
    const prisma = new FakePrismaVoiceCallerIdClient({
      selectedPool: { id: 'pool-1', phoneNumber: '+15550002222' },
    });
    const repository = new PrismaVoiceCallerIdRepository(prisma as never, () => new Date('2026-05-10T19:00:00.000Z'));

    await expect(repository.resolveForReceiver({ receiverId: 'receiver-2', countryCode: 'AE' })).resolves.toBe('+15550002222');

    expect(prisma.voiceCallerIdPool.findFirstCalls).toEqual([
      {
        where: { countryCode: 'AE', status: VoiceCallerIdStatus.ACTIVE, complianceStatus: 'APPROVED' },
        orderBy: [{ assignedCount: 'asc' }, { lastAssignedAt: 'asc' }, { createdAt: 'asc' }],
      },
    ]);
    expect(prisma.receiverVoiceCallerIdAssignment.createCalls).toEqual([
      { data: { receiverId: 'receiver-2', callerIdPoolId: 'pool-1' } },
    ]);
    expect(prisma.voiceCallerIdPool.updateCalls).toEqual([
      {
        where: { id: 'pool-1' },
        data: {
          assignedCount: { increment: 1 },
          lastAssignedAt: new Date('2026-05-10T19:00:00.000Z'),
        },
      },
    ]);
  });

  it('returns undefined when no active caller ID is available for the receiver country', async () => {
    const prisma = new FakePrismaVoiceCallerIdClient({ selectedPool: null });
    const repository = new PrismaVoiceCallerIdRepository(prisma as never);

    await expect(repository.resolveForReceiver({ receiverId: 'receiver-3', countryCode: 'AE' })).resolves.toBeUndefined();
    expect(prisma.receiverVoiceCallerIdAssignment.createCalls).toEqual([]);
    expect(prisma.voiceCallerIdPool.updateCalls).toEqual([]);
  });

  it('does not reuse a sticky caller ID unless its compliance profile is approved', async () => {
    const prisma = new FakePrismaVoiceCallerIdClient({
      existingAssignment: null,
      selectedPool: null,
    });
    const repository = new PrismaVoiceCallerIdRepository(prisma as never);

    await expect(repository.resolveForReceiver({ receiverId: 'receiver-4', countryCode: 'AE' })).resolves.toBeUndefined();

    expect(prisma.receiverVoiceCallerIdAssignment.findFirstCalls).toEqual([
      {
        where: {
          receiverId: 'receiver-4',
          releasedAt: null,
          callerIdPool: { status: VoiceCallerIdStatus.ACTIVE, complianceStatus: 'APPROVED' },
        },
        include: { callerIdPool: true },
      },
    ]);
  });
});

class FakePrismaVoiceCallerIdClient {
  public receiverVoiceCallerIdAssignment: {
    findFirstCalls: unknown[];
    createCalls: unknown[];
    findFirst: (args: unknown) => Promise<{ callerIdPool: { phoneNumber: string } } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  public voiceCallerIdPool: {
    findFirstCalls: unknown[];
    updateCalls: unknown[];
    findFirst: (args: unknown) => Promise<{ id: string; phoneNumber: string } | null>;
    update: (args: unknown) => Promise<unknown>;
  };

  constructor(
    private readonly options: {
      existingAssignment?: { callerIdPool: { phoneNumber: string } } | null;
      selectedPool?: { id: string; phoneNumber: string } | null;
    } = {},
  ) {
    this.receiverVoiceCallerIdAssignment = {
      findFirstCalls: [],
      createCalls: [],
      findFirst: async (args: unknown) => {
        this.receiverVoiceCallerIdAssignment.findFirstCalls.push(args);
        return this.options.existingAssignment ?? null;
      },
      create: async (args: unknown) => {
        this.receiverVoiceCallerIdAssignment.createCalls.push(args);
        return {};
      },
    };
    this.voiceCallerIdPool = {
      findFirstCalls: [],
      updateCalls: [],
      findFirst: async (args: unknown) => {
        this.voiceCallerIdPool.findFirstCalls.push(args);
        return Object.prototype.hasOwnProperty.call(this.options, 'selectedPool')
          ? (this.options.selectedPool ?? null)
          : { id: 'pool-1', phoneNumber: '+15550002222' };
      },
      update: async (args: unknown) => {
        this.voiceCallerIdPool.updateCalls.push(args);
        return {};
      },
    };
  }
}
