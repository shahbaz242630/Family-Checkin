import { ActorType, Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import type { ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from '../channels/channel-provider';
import type { NotificationsService } from '../notifications/notifications.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type {
  CreateEscalationEventInput,
  EscalationBackupContactRecord,
  EscalationEventRecord,
  EscalationsRepository,
} from './escalations.repository';
import { EscalationsService } from './escalations.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryEscalationsRepository implements EscalationsRepository {
  public backupContacts: EscalationBackupContactRecord[] = [];
  public receiverOwnerUserId = 'sender-1';
  public createdEvents: CreateEscalationEventInput[] = [];
  public escalatedCheckIns: string[] = [];
  public terminalStatuses: { checkInId: string; status: CheckInStatus }[] = [];

  async findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]> {
    return this.backupContacts
      .filter((contact) => contact.receiverId === input.receiverId)
      .sort((a, b) => a.priorityOrder - b.priorityOrder || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findReceiverOwner(input: { receiverId: string }): Promise<{ userId: string } | null> {
    return input.receiverId === 'receiver-1' ? { userId: this.receiverOwnerUserId } : null;
  }

  async createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord> {
    this.createdEvents.push(input);
    return {
      id: `escalation-event-${this.createdEvents.length}`,
      ...input,
    };
  }

  async markCheckInEscalated(input: { checkInId: string }): Promise<void> {
    this.escalatedCheckIns.push(input.checkInId);
  }

  async markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void> {
    this.terminalStatuses.push(input);
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      createdAt: new Date('2026-04-29T10:00:00.000Z'),
      ...input,
    };
  }
}

class InMemoryNotificationsService {
  public sent: Array<{
    userId: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }> = [];

  constructor(private readonly result = { attempted: 1, sent: 1, failed: 0, sentAt: new Date('2026-04-29T10:00:00.000Z') }) {}

  async sendToUser(input: { userId: string; title: string; body: string; data: Record<string, string> }) {
    this.sent.push(input);
    return this.result;
  }
}

class FailingFirstSmsProvider implements ChannelProvider {
  public readonly channel = Channel.SMS;
  public readonly sentMessages: { to: string; message: TemplatedMessage }[] = [];

  async sendMessage(to: string, message: TemplatedMessage): Promise<ChannelSendResult> {
    this.sentMessages.push({ to, message });
    if (this.sentMessages.length === 1) {
      throw new Error('provider unavailable');
    }

    return {
      providerMessageId: `fake-SMS-message-${this.sentMessages.length}`,
      acceptedAt: new Date('2026-04-29T10:00:00.000Z'),
      providerStatus: 'accepted',
    };
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<never> {
    throw new Error('Voice not supported by this test provider');
  }

  async isAvailableForNumber(_phone: string): Promise<boolean> {
    return true;
  }
}

class AlwaysFailingSmsProvider implements ChannelProvider {
  public readonly channel = Channel.SMS;

  async sendMessage(_to: string, _message: TemplatedMessage): Promise<never> {
    throw new Error('provider unavailable');
  }

  async makeVoiceCall(_to: string, _script: VoiceScript): Promise<never> {
    throw new Error('Voice not supported by this test provider');
  }

  async isAvailableForNumber(_phone: string): Promise<boolean> {
    return true;
  }
}

describe('EscalationsService', () => {
  it('alerts active backup contacts in priority order and marks a help check-in escalated', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    repository.backupContacts = [
      backupContactFixture(crypto, {
        id: 'backup-contact-second',
        phone: '+971501111111',
        priorityOrder: 2,
        createdAt: new Date('2026-04-29T08:10:00.000Z'),
      }),
      backupContactFixture(crypto, {
        id: 'backup-contact-first',
        phone: '+971502222222',
        priorityOrder: 1,
        createdAt: new Date('2026-04-29T08:20:00.000Z'),
      }),
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    const result = await service.escalateHelpResponse({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sourceChannel: Channel.WHATSAPP,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.ESCALATED,
      attempted: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(sms.sentMessages).toEqual([
      {
        to: '+971502222222',
        message: {
          templateKey: 'backup_contact_help_alert',
          language: 'en',
          variables: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
          },
        },
      },
      {
        to: '+971501111111',
        message: {
          templateKey: 'backup_contact_help_alert',
          language: 'en',
          variables: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
          },
        },
      },
    ]);
    expect(repository.createdEvents).toEqual([
      {
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T10:00:00.000Z'),
        result: EscalationResult.SUCCESS,
        backupAlertedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
      {
        checkInId: 'check-in-1',
        attemptNumber: 2,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T10:00:00.000Z'),
        result: EscalationResult.SUCCESS,
        backupAlertedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);
    expect(repository.escalatedCheckIns).toEqual(['check-in-1']);
    expect(audit.events).toHaveLength(3);
    expect(audit.events[0]).toMatchObject({
      entityType: 'escalation_event',
      entityId: 'escalation-event-1',
      action: 'escalation.backup_contact_alerted',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        checkInId: 'check-in-1',
        backupContactId: 'backup-contact-first',
        channel: Channel.SMS,
        attemptNumber: 1,
        providerStatus: 'accepted',
        sourceChannel: Channel.WHATSAPP,
      },
    });
    expect(audit.events[2]).toMatchObject({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.escalated',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        successfulAlerts: 2,
        failedAlerts: 0,
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
    expect(JSON.stringify(audit.events)).not.toContain('+971501111111');
    expect(JSON.stringify(audit.events)).not.toContain('First Backup');
  });

  it('notifies the sender by mobile push when a receiver help response escalates', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const notifications = new InMemoryNotificationsService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    repository.backupContacts = [
      backupContactFixture(crypto, {
        id: 'backup-contact-first',
        phone: '+971502222222',
        priorityOrder: 1,
        createdAt: new Date('2026-04-29T08:20:00.000Z'),
      }),
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    await service.escalateHelpResponse({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sourceChannel: Channel.WHATSAPP,
    });

    expect(notifications.sent).toEqual([
      {
        userId: 'sender-1',
        title: 'Receiver needs attention',
        body: 'A receiver asked for help during a check-in.',
        data: {
          checkInId: 'check-in-1',
          receiverId: 'receiver-1',
          reason: 'help_response',
        },
      },
    ]);
    expect(repository.createdEvents[0]).toMatchObject({
      senderNotifiedAt: new Date('2026-04-29T10:00:00.000Z'),
    });
    expect(audit.events).toContainEqual({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'sender_push.sent',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        attempted: 1,
        sent: 1,
        failed: 0,
        reason: 'help_response',
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain('ExpoPushToken');
  });

  it('audits and leaves the check-in as responded help when there are no active backup contacts', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new FakeChannelProvider(Channel.SMS);
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    const result = await service.escalateHelpResponse({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sourceChannel: Channel.SMS,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.RESPONDED_HELP,
      attempted: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(repository.createdEvents).toEqual([]);
    expect(repository.escalatedCheckIns).toEqual([]);
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'escalation.no_backup_contacts',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          sourceChannel: Channel.SMS,
        },
      },
    ]);
  });

  it('records provider failures and continues to the next backup contact', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new FailingFirstSmsProvider();
    repository.backupContacts = [
      backupContactFixture(crypto, {
        id: 'backup-contact-first',
        phone: '+971502222222',
        priorityOrder: 1,
        createdAt: new Date('2026-04-29T08:20:00.000Z'),
      }),
      backupContactFixture(crypto, {
        id: 'backup-contact-second',
        phone: '+971501111111',
        priorityOrder: 2,
        createdAt: new Date('2026-04-29T08:10:00.000Z'),
      }),
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    const result = await service.escalateHelpResponse({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sourceChannel: Channel.WHATSAPP,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.ESCALATED,
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(repository.createdEvents).toEqual([
      {
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T10:00:00.000Z'),
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
      {
        checkInId: 'check-in-1',
        attemptNumber: 2,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T10:00:00.000Z'),
        result: EscalationResult.SUCCESS,
        backupAlertedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);
    expect(repository.escalatedCheckIns).toEqual(['check-in-1']);
    expect(audit.events.map((event) => event.action)).toEqual([
      'escalation.backup_contact_failed',
      'escalation.backup_contact_alerted',
      'check_in.escalated',
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
    expect(JSON.stringify(audit.events)).not.toContain('+971501111111');
  });

  it('alerts backup contacts for missed check-ins with missed-check-in template and PII-safe audit', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:45:00.000Z'),
    });
    repository.backupContacts = [
      backupContactFixture(crypto, {
        id: 'backup-contact-first',
        phone: '+971502222222',
        priorityOrder: 1,
        createdAt: new Date('2026-04-29T08:20:00.000Z'),
      }),
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:45:00.000Z'),
    );

    const result = await service.escalateMissedCheckIn({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sentAt: new Date('2026-04-29T10:00:00.000Z'),
      responseWindowMinutes: 30,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.ESCALATED,
      attempted: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(sms.sentMessages).toEqual([
      {
        to: '+971502222222',
        message: {
          templateKey: 'backup_contact_missed_checkin_alert',
          language: 'en',
          variables: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
          },
        },
      },
    ]);
    expect(audit.events[0]).toMatchObject({
      entityType: 'escalation_event',
      entityId: 'escalation-event-1',
      action: 'escalation.backup_contact_alerted',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        checkInId: 'check-in-1',
        backupContactId: 'backup-contact-first',
        channel: Channel.SMS,
        attemptNumber: 1,
        providerStatus: 'accepted',
        escalationReason: 'missed_check_in',
        sentAt: '2026-04-29T10:00:00.000Z',
        responseWindowMinutes: 30,
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
    expect(JSON.stringify(audit.events)).not.toContain('First Backup');
  });

  it('marks missed check-ins skipped when there are no active backup contacts', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new FakeChannelProvider(Channel.SMS);
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:45:00.000Z'),
    );

    const result = await service.escalateMissedCheckIn({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sentAt: new Date('2026-04-29T10:00:00.000Z'),
      responseWindowMinutes: 30,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.SKIPPED,
      attempted: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(repository.terminalStatuses).toEqual([{ checkInId: 'check-in-1', status: CheckInStatus.SKIPPED }]);
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'escalation.no_backup_contacts',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          escalationReason: 'missed_check_in',
          sentAt: '2026-04-29T10:00:00.000Z',
          responseWindowMinutes: 30,
        },
      },
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.escalation_skipped',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          reason: 'no_backup_contacts',
          escalationReason: 'missed_check_in',
        },
      },
    ]);
  });

  it('marks missed check-ins failed when every backup contact alert fails', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const audit = new InMemoryAuditService();
    const sms = new AlwaysFailingSmsProvider();
    repository.backupContacts = [
      backupContactFixture(crypto, {
        id: 'backup-contact-first',
        phone: '+971502222222',
        priorityOrder: 1,
        createdAt: new Date('2026-04-29T08:20:00.000Z'),
      }),
      backupContactFixture(crypto, {
        id: 'backup-contact-second',
        phone: '+971501111111',
        priorityOrder: 2,
        createdAt: new Date('2026-04-29T08:10:00.000Z'),
      }),
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-29T10:45:00.000Z'),
    );

    const result = await service.escalateMissedCheckIn({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sentAt: new Date('2026-04-29T10:00:00.000Z'),
      responseWindowMinutes: 30,
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.FAILED,
      attempted: 2,
      succeeded: 0,
      failed: 2,
    });
    expect(repository.terminalStatuses).toEqual([{ checkInId: 'check-in-1', status: CheckInStatus.FAILED }]);
    expect(repository.createdEvents).toEqual([
      {
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:45:00.000Z'),
        completedAt: new Date('2026-04-29T10:45:00.000Z'),
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
      {
        checkInId: 'check-in-1',
        attemptNumber: 2,
        channel: Channel.SMS,
        startedAt: new Date('2026-04-29T10:45:00.000Z'),
        completedAt: new Date('2026-04-29T10:45:00.000Z'),
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
    ]);
    expect(audit.events.at(-1)).toMatchObject({
      entityType: 'check_in',
      entityId: 'check-in-1',
      action: 'check_in.escalation_failed',
      actorType: ActorType.SYSTEM,
      metadata: {
        receiverId: 'receiver-1',
        failedAlerts: 2,
        escalationReason: 'missed_check_in',
      },
    });
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
    expect(JSON.stringify(audit.events)).not.toContain('+971501111111');
  });
});

function backupContactFixture(
  crypto: CryptoService,
  input: { id: string; phone: string; priorityOrder: number; createdAt: Date },
): EscalationBackupContactRecord {
  return {
    id: input.id,
    receiverId: 'receiver-1',
    nameEncrypted: crypto.encrypt(input.id === 'backup-contact-first' ? 'First Backup' : 'Second Backup'),
    phoneEncrypted: crypto.encrypt(input.phone),
    priorityOrder: input.priorityOrder,
    createdAt: input.createdAt,
  };
}
