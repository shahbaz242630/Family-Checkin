import { Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { OperationsVisibilityRepository } from './operations-visibility.repository';
import { OperationsVisibilityService } from './operations-visibility.service';

class FakeOperationsVisibilityRepository implements OperationsVisibilityRepository {
  public calls: unknown[] = [];

  async countByStatusSince(input: { windowStart: Date }) {
    this.calls.push({ method: 'countByStatusSince', input });
    return [
      { status: CheckInStatus.SENT, count: 2 },
      { status: CheckInStatus.RESOLVED, count: 1 },
    ];
  }

  async findRecentOperationalCheckIns(input: { limit: number }) {
    this.calls.push({ method: 'findRecentOperationalCheckIns', input });
    return [
      {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        status: CheckInStatus.RESOLVED,
        scheduledAt: new Date('2026-04-30T06:30:00.000Z'),
        sentAt: new Date('2026-04-30T06:31:00.000Z'),
        respondedAt: new Date('2026-04-30T06:35:00.000Z'),
        resolvedAt: new Date('2026-04-30T06:45:00.000Z'),
        escalationAttemptCount: 2,
        successfulEscalationCount: 1,
      },
    ];
  }

  async findOperationalCheckInDetail(input: { checkInId: string }) {
    this.calls.push({ method: 'findOperationalCheckInDetail', input });

    if (input.checkInId === 'missing-check-in') {
      return null;
    }

    return {
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
      ],
    };
  }
}

describe('OperationsVisibilityService', () => {
  it('returns a PII-safe check-in summary for the default operations window', async () => {
    const repository = new FakeOperationsVisibilityRepository();
    const service = new OperationsVisibilityService(repository, () => new Date('2026-04-30T07:00:00.000Z'));

    const summary = await service.getCheckInSummary();

    expect(repository.calls).toEqual([
      {
        method: 'countByStatusSince',
        input: { windowStart: new Date('2026-04-29T07:00:00.000Z') },
      },
      {
        method: 'findRecentOperationalCheckIns',
        input: { limit: 25 },
      },
    ]);
    expect(summary).toEqual({
      ok: true,
      windowHours: 24,
      generatedAt: '2026-04-30T07:00:00.000Z',
      statusCounts: {
        SENT: 2,
        RESOLVED: 1,
      },
      recent: [
        {
          checkInId: 'check-in-1',
          receiverId: 'receiver-1',
          status: CheckInStatus.RESOLVED,
          scheduledAt: '2026-04-30T06:30:00.000Z',
          sentAt: '2026-04-30T06:31:00.000Z',
          respondedAt: '2026-04-30T06:35:00.000Z',
          resolvedAt: '2026-04-30T06:45:00.000Z',
          escalationAttemptCount: 2,
          successfulEscalationCount: 1,
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain('phone');
    expect(JSON.stringify(summary)).not.toContain('name');
    expect(JSON.stringify(summary)).not.toContain('transcript');
    expect(JSON.stringify(summary)).not.toContain('message');
  });

  it('returns a PII-safe check-in detail with escalation delivery metadata', async () => {
    const repository = new FakeOperationsVisibilityRepository();
    const service = new OperationsVisibilityService(repository, () => new Date('2026-04-30T07:00:00.000Z'));

    const detail = await service.getCheckInDetail(' check-in-1 ');

    expect(repository.calls).toEqual([
      {
        method: 'findOperationalCheckInDetail',
        input: { checkInId: 'check-in-1' },
      },
    ]);
    expect(detail).toEqual({
      ok: true,
      checkIn: {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        status: CheckInStatus.ESCALATED,
        channelUsed: Channel.SMS,
        scheduledAt: '2026-04-30T06:30:00.000Z',
        sentAt: '2026-04-30T06:31:00.000Z',
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
            startedAt: '2026-04-30T07:01:00.000Z',
            completedAt: '2026-04-30T07:02:00.000Z',
            result: EscalationResult.SUCCESS,
            senderNotifiedAt: '2026-04-30T07:03:00.000Z',
            backupAlertedAt: '2026-04-30T07:04:00.000Z',
          },
        ],
      },
    });
    expect(JSON.stringify(detail)).not.toContain('phone');
    expect(JSON.stringify(detail)).not.toContain('name');
    expect(JSON.stringify(detail)).not.toContain('transcript');
    expect(JSON.stringify(detail)).not.toContain('message');
  });

  it('returns null when an operational check-in detail is not found', async () => {
    const repository = new FakeOperationsVisibilityRepository();
    const service = new OperationsVisibilityService(repository, () => new Date('2026-04-30T07:00:00.000Z'));

    await expect(service.getCheckInDetail('missing-check-in')).resolves.toBeNull();
  });
});
