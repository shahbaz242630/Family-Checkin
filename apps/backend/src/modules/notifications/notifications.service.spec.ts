import { ActorType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import type {
  PushDeviceTokenRecord,
  PushNotificationsRepository,
  RegisterPushDeviceTokenInput,
} from './notifications.repository';
import { NotificationsService } from './notifications.service';

class InMemoryPushNotificationsRepository implements PushNotificationsRepository {
  public tokens: PushDeviceTokenRecord[] = [];
  public registered: RegisterPushDeviceTokenInput[] = [];
  public deactivated: string[] = [];

  async upsertDeviceToken(input: RegisterPushDeviceTokenInput): Promise<PushDeviceTokenRecord> {
    this.registered.push(input);
    const record = {
      id: `device-token-${this.registered.length}`,
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceId: input.deviceId,
      active: true,
      lastRegisteredAt: input.registeredAt,
      createdAt: input.registeredAt,
      updatedAt: input.registeredAt,
    };
    this.tokens.push(record);
    return record;
  }

  async findActiveDeviceTokensForUser(input: { userId: string }): Promise<PushDeviceTokenRecord[]> {
    return this.tokens.filter((token) => token.userId === input.userId && token.active);
  }

  async markDeviceTokenInactive(input: { token: string; inactiveAt: Date }): Promise<void> {
    this.deactivated.push(`${input.token}:${input.inactiveAt.toISOString()}`);
    this.tokens = this.tokens.map((token) => (token.token === input.token ? { ...token, active: false } : token));
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
      ...input,
    };
  }
}

describe('NotificationsService', () => {
  it('registers an Expo push token for a sender and audits without storing token in audit metadata', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    const audit = new InMemoryAuditService();
    const service = new NotificationsService(
      repository,
      audit as unknown as AuditService,
      async () => [{ ok: true, id: 'expo-ticket-1' }],
      () => new Date('2026-05-07T10:00:00.000Z'),
    );

    const result = await service.registerDeviceToken({
      userId: 'sender-1',
      token: 'ExpoPushToken[abc123]',
      platform: 'ios',
      deviceId: 'device-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(result).toEqual({
      id: 'device-token-1',
      platform: 'ios',
      active: true,
      registeredAt: '2026-05-07T10:00:00.000Z',
    });
    expect(repository.registered).toEqual([
      {
        userId: 'sender-1',
        token: 'ExpoPushToken[abc123]',
        platform: 'ios',
        deviceId: 'device-1',
        registeredAt: new Date('2026-05-07T10:00:00.000Z'),
      },
    ]);
    expect(audit.events).toEqual([
      {
        entityType: 'user',
        entityId: 'sender-1',
        action: 'push.device_token_registered',
        actorType: ActorType.USER,
        actorId: 'sender-1',
        metadata: {
          platform: 'ios',
          deviceIdPresent: true,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('ExpoPushToken');
  });

  it('sends push notifications to active sender devices and deactivates unregistered tokens', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    const audit = new InMemoryAuditService();
    repository.tokens = [
      tokenFixture('sender-1', 'ExpoPushToken[good]'),
      tokenFixture('sender-1', 'ExpoPushToken[stale]'),
      tokenFixture('other-sender', 'ExpoPushToken[other]'),
    ];
    const sentPayloads: unknown[] = [];
    const service = new NotificationsService(
      repository,
      audit as unknown as AuditService,
      async (messages) => {
        sentPayloads.push(messages);
        return [
          { ok: true, id: 'expo-ticket-good' },
          { ok: false, error: 'DeviceNotRegistered' },
        ];
      },
      () => new Date('2026-05-07T10:00:00.000Z'),
    );

    const result = await service.sendToUser({
      userId: 'sender-1',
      title: 'Receiver needs attention',
      body: 'A receiver missed a check-in.',
      data: {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
      },
    });

    expect(result).toEqual({
      attempted: 2,
      sent: 1,
      failed: 1,
      sentAt: new Date('2026-05-07T10:00:00.000Z'),
    });
    expect(sentPayloads).toEqual([
      [
        {
          to: 'ExpoPushToken[good]',
          title: 'Receiver needs attention',
          body: 'A receiver missed a check-in.',
          data: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
          },
        },
        {
          to: 'ExpoPushToken[stale]',
          title: 'Receiver needs attention',
          body: 'A receiver missed a check-in.',
          data: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
          },
        },
      ],
    ]);
    expect(repository.deactivated).toEqual(['ExpoPushToken[stale]:2026-05-07T10:00:00.000Z']);
  });

  it('sends escalation alerts with siren baseline delivery fields', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    const audit = new InMemoryAuditService();
    repository.tokens = [tokenFixture('sender-1', 'ExpoPushToken[good]')];
    const sentPayloads: unknown[] = [];
    const service = new NotificationsService(
      repository,
      audit as unknown as AuditService,
      async (messages) => {
        sentPayloads.push(messages);
        return [{ ok: true, id: 'expo-ticket-good' }];
      },
      () => new Date('2026-05-07T10:00:00.000Z'),
    );

    await service.sendEscalationAlertToUser({
      userId: 'sender-1',
      title: 'Receiver needs attention',
      body: 'A receiver missed a check-in.',
      data: {
        checkInId: 'check-in-1',
        receiverId: 'receiver-1',
        reason: 'missed_check_in',
      },
    });

    expect(sentPayloads).toEqual([
      [
        {
          to: 'ExpoPushToken[good]',
          title: 'Receiver needs attention',
          body: 'A receiver missed a check-in.',
          data: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
            reason: 'missed_check_in',
            notificationType: 'escalation_siren',
            deepLink: '/(main)',
          },
          sound: 'default',
          priority: 'high',
          channelId: 'emergency-alerts',
          interruptionLevel: 'timeSensitive',
        },
      ],
    ]);
  });
});

function tokenFixture(userId: string, token: string): PushDeviceTokenRecord {
  return {
    id: token,
    userId,
    token,
    platform: 'ios',
    deviceId: undefined,
    active: true,
    lastRegisteredAt: new Date('2026-05-07T09:00:00.000Z'),
    createdAt: new Date('2026-05-07T09:00:00.000Z'),
    updatedAt: new Date('2026-05-07T09:00:00.000Z'),
  };
}
