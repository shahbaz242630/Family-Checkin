import { ActorType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from './expo-push.gateway';
import type {
  PushDeviceTokenRecord,
  PushNotificationsRepository,
  PushTicketRecord,
  RegisterPushDeviceTokenInput,
} from './notifications.repository';
import { NotificationsService } from './notifications.service';

class InMemoryPushNotificationsRepository implements PushNotificationsRepository {
  public tokens: PushDeviceTokenRecord[] = [];
  public registered: RegisterPushDeviceTokenInput[] = [];
  public deactivated: string[] = [];
  public tickets: PushTicketRecord[] = [];
  public deletedTicketIds: string[] = [];
  public ticketQueries: Array<{ before: Date; limit: number }> = [];
  public recordTicketsFails = false;

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

  async recordPushTickets(input: {
    tickets: Array<{ ticketId: string; token: string }>;
    createdAt: Date;
  }): Promise<void> {
    if (this.recordTicketsFails) {
      throw new Error('tickets table unavailable');
    }
    for (const ticket of input.tickets) {
      if (!this.tickets.some((existing) => existing.ticketId === ticket.ticketId)) {
        this.tickets.push({ ...ticket, createdAt: input.createdAt });
      }
    }
  }

  async findPushTicketsCreatedBefore(input: { before: Date; limit: number }): Promise<PushTicketRecord[]> {
    this.ticketQueries.push(input);
    return this.tickets
      .filter((ticket) => ticket.createdAt < input.before)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, input.limit);
  }

  async deletePushTickets(input: { ticketIds: string[] }): Promise<void> {
    this.deletedTicketIds.push(...input.ticketIds);
    this.tickets = this.tickets.filter((ticket) => !input.ticketIds.includes(ticket.ticketId));
  }
}

/** A gateway object with receipts, the shape ExpoPushGateway has in production. */
class FakePushGateway {
  public sent: ExpoPushMessage[][] = [];
  public receiptQueries: string[][] = [];

  constructor(
    private readonly ticketsFor: (messages: ExpoPushMessage[]) => ExpoPushTicket[],
    private readonly receipts: ExpoPushReceipt[] = [],
  ) {}

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    this.sent.push(messages);
    return this.ticketsFor(messages);
  }

  async getReceipts(ticketIds: string[]): Promise<ExpoPushReceipt[]> {
    this.receiptQueries.push(ticketIds);
    return this.receipts.filter((receipt) => ticketIds.includes(receipt.id));
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
          sound: 'escalation-siren.wav',
          priority: 'high',
          channelId: 'emergency-alerts',
          interruptionLevel: 'timeSensitive',
        },
      ],
    ]);
  });

  it('sends quiet updates with the default sound and none of the siren delivery fields (CB-012)', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [tokenFixture('sender-1', 'ExpoPushToken[good]')];
    const sentPayloads: unknown[][] = [];
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      async (messages) => {
        sentPayloads.push(messages);
        return [{ ok: true, id: 'expo-ticket-good' }];
      },
      () => new Date('2026-05-07T10:00:00.000Z'),
    );

    const result = await service.sendQuietUpdateToUser({
      userId: 'sender-1',
      title: 'Consent received',
      body: 'Your receiver agreed to Nearby check-ins.',
      data: {
        receiverId: 'receiver-1',
        reason: 'consent_granted',
        deepLink: '/(main)/receivers/receiver-1',
      },
    });

    expect(result).toEqual({ attempted: 1, sent: 1, failed: 0, sentAt: new Date('2026-05-07T10:00:00.000Z') });
    expect(sentPayloads).toEqual([
      [
        {
          to: 'ExpoPushToken[good]',
          title: 'Consent received',
          body: 'Your receiver agreed to Nearby check-ins.',
          data: {
            receiverId: 'receiver-1',
            reason: 'consent_granted',
            deepLink: '/(main)/receivers/receiver-1',
            notificationType: 'quiet_update',
          },
          sound: 'default',
        },
      ],
    ]);
    const message = sentPayloads[0]?.[0] as Record<string, unknown>;
    expect(message).not.toHaveProperty('channelId');
    expect(message).not.toHaveProperty('interruptionLevel');
    expect(message).not.toHaveProperty('priority');
  });

  it('falls back to the home tab deep link for a quiet update without one', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [tokenFixture('sender-1', 'ExpoPushToken[good]')];
    const sentPayloads: unknown[][] = [];
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      async (messages) => {
        sentPayloads.push(messages);
        return [{ ok: true, id: 'expo-ticket-good' }];
      },
    );

    await service.sendQuietUpdateToUser({
      userId: 'sender-1',
      title: 'Check-ins stopped',
      body: 'Your receiver replied STOP.',
      data: { receiverId: 'receiver-1', reason: 'receiver_opted_out' },
    });

    expect((sentPayloads[0]?.[0] as { data: Record<string, string> }).data.deepLink).toBe('/(main)');
  });
});

describe('NotificationsService push receipts (CB-023)', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

  it('files the ticket id of every accepted send against its token', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [tokenFixture('sender-1', 'ExpoPushToken[a]'), tokenFixture('sender-1', 'ExpoPushToken[b]')];
    const gateway = new FakePushGateway(() => [
      { ok: true, id: 'ticket-a' },
      { ok: false, error: 'MessageTooBig' },
    ]);
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      gateway,
      () => now,
    );

    await service.sendQuietUpdateToUser({ userId: 'sender-1', title: 'T', body: 'B', data: {} });

    expect(repository.tickets).toEqual([{ ticketId: 'ticket-a', token: 'ExpoPushToken[a]', createdAt: now }]);
  });

  it('deactivates the token whose receipt says DeviceNotRegistered and deletes the processed tickets', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [
      tokenFixture('sender-1', 'ExpoPushToken[dead]'),
      tokenFixture('sender-1', 'ExpoPushToken[fine]'),
      tokenFixture('sender-1', 'ExpoPushToken[young]'),
      tokenFixture('sender-1', 'ExpoPushToken[forgotten]'),
    ];
    repository.tickets = [
      { ticketId: 'ticket-dead', token: 'ExpoPushToken[dead]', createdAt: minutesAgo(20) },
      { ticketId: 'ticket-fine', token: 'ExpoPushToken[fine]', createdAt: minutesAgo(30) },
      { ticketId: 'ticket-pending', token: 'ExpoPushToken[fine]', createdAt: minutesAgo(16) },
      { ticketId: 'ticket-young', token: 'ExpoPushToken[young]', createdAt: minutesAgo(5) },
      { ticketId: 'ticket-forgotten', token: 'ExpoPushToken[forgotten]', createdAt: minutesAgo(25 * 60) },
    ];
    const gateway = new FakePushGateway(
      () => [],
      [
        { id: 'ticket-dead', ok: false, error: 'DeviceNotRegistered' },
        { id: 'ticket-fine', ok: true },
      ],
    );
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      gateway,
      () => now,
    );

    const result = await service.processDuePushReceipts();

    expect(result).toEqual({ checked: 4, received: 2, deactivated: 1, expired: 1 });
    expect(gateway.receiptQueries).toEqual([['ticket-forgotten', 'ticket-fine', 'ticket-dead', 'ticket-pending']]);
    expect(repository.ticketQueries).toEqual([{ before: minutesAgo(15), limit: 300 }]);
    expect(repository.deactivated).toEqual(['ExpoPushToken[dead]:2026-09-06T12:00:00.000Z']);
    expect(repository.tokens.find((token) => token.token === 'ExpoPushToken[dead]')?.active).toBe(false);
    expect(repository.tokens.find((token) => token.token === 'ExpoPushToken[fine]')?.active).toBe(true);
    expect(repository.deletedTicketIds.sort()).toEqual(['ticket-dead', 'ticket-fine', 'ticket-forgotten']);
    expect(repository.tickets.map((ticket) => ticket.ticketId).sort()).toEqual(['ticket-pending', 'ticket-young']);
  });

  it('processes due receipts in the background after a send so a dead token is not tried on the next batch', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [
      tokenFixture('sender-1', 'ExpoPushToken[dead]'),
      tokenFixture('sender-1', 'ExpoPushToken[fine]'),
    ];
    repository.tickets = [{ ticketId: 'ticket-dead', token: 'ExpoPushToken[dead]', createdAt: minutesAgo(20) }];
    const gateway = new FakePushGateway(
      (messages) => messages.map((_, index) => ({ ok: true, id: `ticket-${index}` })),
      [{ id: 'ticket-dead', ok: false, error: 'DeviceNotRegistered' }],
    );
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      gateway,
      () => now,
    );

    const result = await service.sendEscalationAlertToUser({ userId: 'sender-1', title: 'T', body: 'B', data: {} });

    // The siren is not held behind the receipt check: both tokens were still active when it went out.
    expect(result).toMatchObject({ attempted: 2, sent: 2, failed: 0 });
    expect(gateway.sent[0]?.map((message) => message.to)).toEqual(['ExpoPushToken[dead]', 'ExpoPushToken[fine]']);

    await service.waitForReceiptHousekeeping();

    expect(gateway.receiptQueries).toEqual([['ticket-dead']]);
    expect(repository.tokens.find((token) => token.token === 'ExpoPushToken[dead]')?.active).toBe(false);

    const next = await service.sendEscalationAlertToUser({ userId: 'sender-1', title: 'T', body: 'B', data: {} });

    expect(next).toMatchObject({ attempted: 1, sent: 1, failed: 0 });
    expect(gateway.sent[1]?.map((message) => message.to)).toEqual(['ExpoPushToken[fine]']);
  });

  it('does nothing without a receipts-capable gateway or without due tickets', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tickets = [{ ticketId: 'ticket-1', token: 'ExpoPushToken[a]', createdAt: minutesAgo(60) }];
    const bareSend = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      async () => [],
      () => now,
    );
    const noTickets = new NotificationsService(
      new InMemoryPushNotificationsRepository(),
      new InMemoryAuditService() as unknown as AuditService,
      new FakePushGateway(() => []),
      () => now,
    );

    await expect(bareSend.processDuePushReceipts()).resolves.toEqual({
      checked: 0,
      received: 0,
      deactivated: 0,
      expired: 0,
    });
    await expect(noTickets.processDuePushReceipts()).resolves.toEqual({
      checked: 0,
      received: 0,
      deactivated: 0,
      expired: 0,
    });
    expect(repository.tickets).toHaveLength(1);
  });

  it('still reports the push as sent when the receipt check or the ticket filing fails', async () => {
    const repository = new InMemoryPushNotificationsRepository();
    repository.tokens = [tokenFixture('sender-1', 'ExpoPushToken[fine]')];
    repository.tickets = [{ ticketId: 'ticket-old', token: 'ExpoPushToken[fine]', createdAt: minutesAgo(20) }];
    repository.recordTicketsFails = true;
    const gateway = new FakePushGateway(() => [{ ok: true, id: 'ticket-new' }]);
    gateway.getReceipts = async () => {
      throw new Error('Expo push receipts request failed with 503');
    };
    const service = new NotificationsService(
      repository,
      new InMemoryAuditService() as unknown as AuditService,
      gateway,
      () => now,
    );

    await expect(
      service.sendQuietUpdateToUser({ userId: 'sender-1', title: 'T', body: 'B', data: {} }),
    ).resolves.toEqual({ attempted: 1, sent: 1, failed: 0, sentAt: now });
    await expect(service.waitForReceiptHousekeeping()).resolves.toBeUndefined();
    expect(repository.tickets.map((ticket) => ticket.ticketId)).toEqual(['ticket-old']);
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
