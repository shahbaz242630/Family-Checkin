import { Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaOperationsVisibilityRepository } from './prisma-operations-visibility.repository';

describe('PrismaOperationsVisibilityRepository', () => {
  it('counts check-ins by status inside the window and excludes soft-deleted receivers', async () => {
    const calls: unknown[] = [];
    const prisma = {
      checkIn: {
        groupBy: async (args: unknown) => {
          calls.push(args);
          return [
            { status: CheckInStatus.SENT, _count: { _all: 2 } },
            { status: CheckInStatus.RESOLVED, _count: { _all: 1 } },
          ];
        },
        findMany: async () => [],
        findFirst: async () => null,
      },
    };
    const repository = new PrismaOperationsVisibilityRepository(prisma);
    const windowStart = new Date('2026-04-29T07:00:00.000Z');

    const counts = await repository.countByStatusSince({ windowStart });

    expect(calls).toEqual([
      {
        by: ['status'],
        where: {
          scheduledAt: { gte: windowStart },
          receiver: { deletedAt: null },
        },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      },
    ]);
    expect(counts).toEqual([
      { status: CheckInStatus.SENT, count: 2 },
      { status: CheckInStatus.RESOLVED, count: 1 },
    ]);
  });

  it('finds recent operational check-ins with escalation counts and no PII selection', async () => {
    const calls: unknown[] = [];
    const prisma = {
      checkIn: {
        groupBy: async () => [],
        findMany: async (args: unknown) => {
          calls.push(args);
          return [
            {
              id: 'check-in-1',
              receiverId: 'receiver-1',
              status: CheckInStatus.ESCALATED,
              scheduledAt: new Date('2026-04-30T06:30:00.000Z'),
              sentAt: new Date('2026-04-30T06:31:00.000Z'),
              respondedAt: null,
              resolvedAt: null,
              escalations: [{ result: EscalationResult.SUCCESS }, { result: EscalationResult.ERROR }],
              _count: { escalations: 2 },
            },
          ];
        },
        findFirst: async () => null,
      },
    };
    const repository = new PrismaOperationsVisibilityRepository(prisma);

    const recent = await repository.findRecentOperationalCheckIns({ limit: 10 });

    expect(calls).toEqual([
      {
        where: {
          status: {
            in: [
              CheckInStatus.RESPONDED_HELP,
              CheckInStatus.ESCALATED,
              CheckInStatus.FAILED,
              CheckInStatus.SKIPPED,
              CheckInStatus.RESOLVED,
            ],
          },
          receiver: { deletedAt: null },
        },
        select: {
          id: true,
          receiverId: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          respondedAt: true,
          resolvedAt: true,
          escalations: {
            select: { result: true },
          },
          _count: {
            select: { escalations: true },
          },
        },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
    ]);
    expect(recent).toEqual([
      {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        status: CheckInStatus.ESCALATED,
        scheduledAt: new Date('2026-04-30T06:30:00.000Z'),
        sentAt: new Date('2026-04-30T06:31:00.000Z'),
        respondedAt: undefined,
        resolvedAt: undefined,
        escalationAttemptCount: 2,
        successfulEscalationCount: 1,
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('nameEncrypted');
    expect(JSON.stringify(calls)).not.toContain('phoneEncrypted');
    expect(JSON.stringify(calls)).not.toContain('responseTranscript');
  });

  it('finds one operational check-in detail with escalation events and no PII selection', async () => {
    const calls: unknown[] = [];
    const prisma = {
      checkIn: {
        groupBy: async () => [],
        findMany: async () => [],
        findFirst: async (args: unknown) => {
          calls.push(args);
          return {
            id: 'check-in-1',
            receiverId: 'receiver-1',
            status: CheckInStatus.ESCALATED,
            channelUsed: Channel.SMS,
            scheduledAt: new Date('2026-04-30T06:30:00.000Z'),
            sentAt: new Date('2026-04-30T06:31:00.000Z'),
            respondedAt: null,
            responseDetectedAs: null,
            resolvedAt: null,
            escalations: [
              {
                id: 'escalation-1',
                attemptNumber: 1,
                channel: Channel.SMS,
                startedAt: new Date('2026-04-30T07:01:00.000Z'),
                completedAt: new Date('2026-04-30T07:02:00.000Z'),
                result: EscalationResult.SUCCESS,
                senderNotifiedAt: new Date('2026-04-30T07:03:00.000Z'),
                backupAlertedAt: new Date('2026-04-30T07:04:00.000Z'),
              },
              {
                id: 'escalation-2',
                attemptNumber: 2,
                channel: Channel.VOICE,
                startedAt: new Date('2026-04-30T07:05:00.000Z'),
                completedAt: null,
                result: EscalationResult.ERROR,
                senderNotifiedAt: null,
                backupAlertedAt: null,
              },
            ],
            _count: { escalations: 2 },
          };
        },
      },
    };
    const repository = new PrismaOperationsVisibilityRepository(prisma);

    const detail = await repository.findOperationalCheckInDetail({ checkInId: 'check-in-1' });

    expect(calls).toEqual([
      {
        where: {
          id: 'check-in-1',
          receiver: { deletedAt: null },
        },
        select: {
          id: true,
          receiverId: true,
          status: true,
          channelUsed: true,
          scheduledAt: true,
          sentAt: true,
          respondedAt: true,
          responseDetectedAs: true,
          resolvedAt: true,
          escalations: {
            select: {
              id: true,
              attemptNumber: true,
              channel: true,
              startedAt: true,
              completedAt: true,
              result: true,
              senderNotifiedAt: true,
              backupAlertedAt: true,
            },
            orderBy: { attemptNumber: 'asc' },
          },
          _count: {
            select: { escalations: true },
          },
        },
      },
    ]);
    expect(detail).toEqual({
      checkInId: 'check-in-1',
      receiverId: 'receiver-1',
      status: CheckInStatus.ESCALATED,
      channelUsed: Channel.SMS,
      scheduledAt: new Date('2026-04-30T06:30:00.000Z'),
      sentAt: new Date('2026-04-30T06:31:00.000Z'),
      respondedAt: undefined,
      responseDetectedAs: undefined,
      resolvedAt: undefined,
      escalationAttemptCount: 2,
      successfulEscalationCount: 1,
      escalations: [
        {
          id: 'escalation-1',
          attemptNumber: 1,
          channel: Channel.SMS,
          startedAt: new Date('2026-04-30T07:01:00.000Z'),
          completedAt: new Date('2026-04-30T07:02:00.000Z'),
          result: EscalationResult.SUCCESS,
          senderNotifiedAt: new Date('2026-04-30T07:03:00.000Z'),
          backupAlertedAt: new Date('2026-04-30T07:04:00.000Z'),
        },
        {
          id: 'escalation-2',
          attemptNumber: 2,
          channel: Channel.VOICE,
          startedAt: new Date('2026-04-30T07:05:00.000Z'),
          completedAt: undefined,
          result: EscalationResult.ERROR,
          senderNotifiedAt: undefined,
          backupAlertedAt: undefined,
        },
      ],
    });
    expect(JSON.stringify(calls)).not.toContain('nameEncrypted');
    expect(JSON.stringify(calls)).not.toContain('phoneEncrypted');
    expect(JSON.stringify(calls)).not.toContain('responseTranscript');
    expect(JSON.stringify(calls)).not.toContain('resolutionNote');
    expect(JSON.stringify(calls)).not.toContain('errorDetails');
  });
});
