import { ActorType, Channel, CheckInStatus, EscalationResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ChannelRouterService } from '../channels/channel-router.service';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import type { ChannelProvider, ChannelSendResult, TemplatedMessage, VoiceScript } from '../channels/channel-provider';
import type { NotificationsService } from '../notifications/notifications.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { createRealAuditService } from '../../shared/testing/real-audit';
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
  public receiverOwnerPhoneEncrypted = new CryptoService(masterKey).encrypt('+971509999999');
  public createdEvents: CreateEscalationEventInput[] = [];
  public escalatedCheckIns: string[] = [];
  public terminalStatuses: { checkInId: string; status: CheckInStatus }[] = [];

  async findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]> {
    return this.backupContacts
      .filter((contact) => contact.receiverId === input.receiverId)
      .sort((a, b) => a.priorityOrder - b.priorityOrder || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findReceiverOwner(input: { receiverId: string }): Promise<{ userId: string; phoneEncrypted: string } | null> {
    return input.receiverId === 'receiver-1'
      ? { userId: this.receiverOwnerUserId, phoneEncrypted: this.receiverOwnerPhoneEncrypted }
      : null;
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

class InMemoryNotificationsService {
  public sent: Array<{
    userId: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }> = [];

  constructor(
    private readonly result: { attempted: number; sent: number; failed: number; sentAt?: Date } = {
      attempted: 1,
      sent: 1,
      failed: 0,
      sentAt: new Date('2026-04-29T10:00:00.000Z'),
    },
  ) {}

  async sendToUser(input: { userId: string; title: string; body: string; data: Record<string, string> }) {
    this.sent.push(input);
    return this.result;
  }

  async sendEscalationAlertToUser(input: {
    userId: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }) {
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
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
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
      new ChannelRouterService([sms, whatsapp]),
      auditService,
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
            receiverName: 'the person you are a backup contact for',
            senderDisplayName: 'their family member',
            reason: 'help_response',
            contactName: 'First Backup',
          },
        },
      },
      {
        to: '+971501111111',
        message: {
          templateKey: 'backup_contact_help_alert',
          language: 'en',
          variables: {
            receiverName: 'the person you are a backup contact for',
            senderDisplayName: 'their family member',
            reason: 'help_response',
            contactName: 'Second Backup',
          },
        },
      },
    ]);
    expect(whatsapp.sentMessages.map((sent) => sent.to)).toEqual(['+971502222222', '+971501111111']);
    expect(
      repository.createdEvents.map((event) => ({
        attemptNumber: event.attemptNumber,
        channel: event.channel,
        result: event.result,
      })),
    ).toEqual([
      { attemptNumber: 1, channel: Channel.SMS, result: EscalationResult.SUCCESS },
      { attemptNumber: 1, channel: Channel.WHATSAPP, result: EscalationResult.SUCCESS },
      { attemptNumber: 2, channel: Channel.SMS, result: EscalationResult.SUCCESS },
      { attemptNumber: 2, channel: Channel.WHATSAPP, result: EscalationResult.SUCCESS },
    ]);
    expect(repository.escalatedCheckIns).toEqual(['check-in-1']);
    expect(audit.events).toHaveLength(5);
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
    expect(audit.events[4]).toMatchObject({
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

  it('alerts each backup contact over both SMS and WhatsApp', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
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
      new ChannelRouterService([sms, whatsapp]),
      auditService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    const result = await service.escalateSenderRequestedBackup({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
    });

    expect(result).toEqual({
      checkInId: 'check-in-1',
      status: CheckInStatus.ESCALATED,
      attempted: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(sms.sentMessages).toHaveLength(1);
    expect(whatsapp.sentMessages).toHaveLength(1);
    expect(repository.createdEvents).toEqual([
      expect.objectContaining({
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.SMS,
        result: EscalationResult.SUCCESS,
      }),
      expect.objectContaining({
        checkInId: 'check-in-1',
        attemptNumber: 1,
        channel: Channel.WHATSAPP,
        result: EscalationResult.SUCCESS,
      }),
    ]);
  });

  it('notifies the sender by mobile push when a receiver help response escalates', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
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
      auditService,
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

  it('places a fallback voice call to the sender when escalation push is not delivered', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const notifications = new InMemoryNotificationsService({
      attempted: 0,
      sent: 0,
      failed: 0,
      sentAt: undefined,
    });
    const voice = new FakeChannelProvider(Channel.VOICE, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      notifications as unknown as NotificationsService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    await service.escalateMissedCheckIn({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sentAt: new Date('2026-04-29T09:30:00.000Z'),
      responseWindowMinutes: 30,
    });

    expect(voice.voiceCalls).toEqual([
      {
        to: '+971509999999',
        script: {
          scriptKey: 'sender_escalation_siren_voice',
          language: 'en',
          variables: {
            checkInId: 'check-in-1',
            receiverId: 'receiver-1',
            reason: 'missed_check_in',
          },
        },
      },
    ]);
    expect(audit.events).toContainEqual(
      expect.objectContaining({
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'sender_voice_fallback.sent',
        metadata: {
          receiverId: 'receiver-1',
          reason: 'missed_check_in',
          providerStatus: 'accepted',
        },
      }),
    );
    expect(JSON.stringify(audit.events)).not.toContain('+971509999999');
  });

  it('audits and leaves the check-in as responded help when there are no active backup contacts', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS);
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      auditService,
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
    const { auditService, audit } = createRealAuditService();
    const sms = new FailingFirstSmsProvider();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
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
      new ChannelRouterService([sms, whatsapp]),
      auditService,
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
    expect(
      repository.createdEvents.map((event) => ({
        attemptNumber: event.attemptNumber,
        channel: event.channel,
        result: event.result,
      })),
    ).toEqual([
      { attemptNumber: 1, channel: Channel.SMS, result: EscalationResult.ERROR },
      { attemptNumber: 1, channel: Channel.WHATSAPP, result: EscalationResult.SUCCESS },
      { attemptNumber: 2, channel: Channel.SMS, result: EscalationResult.SUCCESS },
      { attemptNumber: 2, channel: Channel.WHATSAPP, result: EscalationResult.SUCCESS },
    ]);
    expect(repository.escalatedCheckIns).toEqual(['check-in-1']);
    expect(audit.events.map((event) => event.action)).toEqual([
      'escalation.backup_contact_failed',
      'escalation.backup_contact_alerted',
      'escalation.backup_contact_alerted',
      'escalation.backup_contact_alerted',
      'check_in.escalated',
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
    expect(JSON.stringify(audit.events)).not.toContain('+971501111111');
  });

  it('alerts backup contacts for missed check-ins with missed-check-in template and PII-safe audit', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:45:00.000Z'),
    });
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
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
      new ChannelRouterService([sms, whatsapp]),
      auditService,
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
            receiverName: 'the person you are a backup contact for',
            senderDisplayName: 'their family member',
            reason: 'missed_check_in',
            contactName: 'First Backup',
          },
        },
      },
    ]);
    expect(whatsapp.sentMessages).toHaveLength(1);
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
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS);
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      auditService,
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
    const { auditService, audit } = createRealAuditService();
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
      auditService,
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
    expect(
      repository.createdEvents
        .map((event) => ({
          attemptNumber: event.attemptNumber,
          channel: event.channel,
          result: event.result,
          errorDetails: event.errorDetails,
        }))
        .sort((left, right) => left.attemptNumber - right.attemptNumber || left.channel.localeCompare(right.channel)),
    ).toEqual([
      {
        attemptNumber: 1,
        channel: Channel.SMS,
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
      {
        attemptNumber: 1,
        channel: Channel.WHATSAPP,
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
      {
        attemptNumber: 2,
        channel: Channel.SMS,
        result: EscalationResult.ERROR,
        errorDetails: 'provider_send_failed',
      },
      {
        attemptNumber: 2,
        channel: Channel.WHATSAPP,
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

  it('names the receiver, the channels already tried and where to find them in every backup alert', async () => {
    const crypto = new CryptoService(masterKey);
    class NamedReceiverRepository extends InMemoryEscalationsRepository {
      override async findReceiverOwner(input: { receiverId: string }) {
        const owner = await super.findReceiverOwner(input);
        return owner ? { ...owner, receiverNameEncrypted: crypto.encrypt('Fatima'), receiverLanguage: 'ar' } : null;
      }

      async findChannelsTriedForCheckIn(): Promise<Channel[]> {
        return [Channel.WHATSAPP, Channel.SMS];
      }
    }
    const repository = new NamedReceiverRepository();
    const { auditService, audit } = createRealAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      now: () => new Date('2026-04-29T10:00:00.000Z'),
    });
    repository.backupContacts = [
      {
        ...backupContactFixture(crypto, {
          id: 'backup-contact-first',
          phone: '+971502222222',
          priorityOrder: 1,
          createdAt: new Date('2026-04-29T08:20:00.000Z'),
        }),
        locationInstructionsEncrypted: crypto.encrypt('Flat 12, blue door'),
      },
    ];
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([sms, whatsapp]),
      auditService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    const result = await service.escalateMissedCheckIn({
      receiverId: 'receiver-1',
      checkInId: 'check-in-1',
      sentAt: new Date('2026-04-29T09:00:00.000Z'),
      responseWindowMinutes: 30,
    });

    expect(result.status).toBe(CheckInStatus.ESCALATED);
    expect(sms.sentMessages[0]?.message).toEqual({
      templateKey: 'backup_contact_missed_checkin_alert',
      language: 'ar',
      variables: {
        receiverName: 'Fatima',
        senderDisplayName: 'their family member',
        reason: 'missed_check_in',
        channelsTried: 'WhatsApp and SMS',
        contactName: 'First Backup',
        locationInstructions: 'Flat 12, blue door',
      },
    });
    expect(sms.renderedMessages[0]).toEqual({
      to: '+971502222222',
      templateKey: 'backup_contact_missed_checkin_alert',
      language: 'en',
      fallback: true,
      body:
        "Hi First Backup, this is Nearby. Fatima did not answer today's check-in from their family member. " +
        'We tried WhatsApp and SMS. Please check on them. Where to find them: Flat 12, blue door ' +
        'Reply DONE once you have reached them.',
    });
    expect(whatsapp.sentMessages[0]?.message.variables).toEqual(sms.sentMessages[0]?.message.variables);
    expect(audit.events.find((event) => event.action === 'escalation.backup_contact_alerted')).toMatchObject({
      metadata: { backupContactId: 'backup-contact-first', renderedLanguage: 'en', renderFallback: true },
    });
    expect(JSON.stringify(audit.events)).not.toContain('Fatima');
    expect(JSON.stringify(audit.events)).not.toContain('Flat 12');
    expect(JSON.stringify(audit.events)).not.toContain('+971502222222');
  });
});

describe('EscalationsService notifies the sender of a missed check-in (CB-005)', () => {
  it('sends one siren push that deep-links to the receiver and alerts no backup contact', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const notifications = new InMemoryNotificationsService();
    const sms = new FakeChannelProvider(Channel.SMS);
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
      auditService,
      notifications as unknown as NotificationsService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    await service.notifySenderOfMissedCheckIn({ receiverId: 'receiver-1', checkInId: 'check-in-1' });

    expect(notifications.sent).toEqual([
      {
        userId: 'sender-1',
        title: 'Missed check-in',
        body: 'A receiver has not answered any check-in attempt today. Open the app to decide what to do next.',
        data: {
          checkInId: 'check-in-1',
          receiverId: 'receiver-1',
          reason: 'cascade_exhausted',
          deepLink: '/(main)/receivers/receiver-1',
        },
      },
    ]);
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'sender_push.sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          attempted: 1,
          sent: 1,
          failed: 0,
          reason: 'cascade_exhausted',
        },
      },
    ]);
    expect(sms.sentMessages).toEqual([]);
    expect(repository.createdEvents).toEqual([]);
    expect(repository.escalatedCheckIns).toEqual([]);
    expect(repository.terminalStatuses).toEqual([]);
  });

  it('calls the sender with the siren script when the missed check-in push is not delivered', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const notifications = new InMemoryNotificationsService({ attempted: 0, sent: 0, failed: 0, sentAt: undefined });
    const voice = new FakeChannelProvider(Channel.VOICE, { now: () => new Date('2026-04-29T10:00:00.000Z') });
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([voice]),
      auditService,
      notifications as unknown as NotificationsService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    await service.notifySenderOfMissedCheckIn({ receiverId: 'receiver-1', checkInId: 'check-in-1' });

    expect(voice.voiceCalls.map((call) => call.to)).toEqual(['+971509999999']);
    expect(voice.voiceCalls[0]?.script).toMatchObject({
      scriptKey: 'sender_escalation_siren_voice',
      variables: expect.objectContaining({ reason: 'cascade_exhausted' }) as unknown,
    });
    expect(audit.events.map((event) => event.action)).toEqual([
      'sender_push.not_delivered',
      'sender_voice_fallback.sent',
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+971509999999');
  });

  it('does nothing when the receiver has no owner to notify', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryEscalationsRepository();
    const { auditService, audit } = createRealAuditService();
    const notifications = new InMemoryNotificationsService();
    const service = new EscalationsService(
      repository,
      crypto,
      new ChannelRouterService([]),
      auditService,
      notifications as unknown as NotificationsService,
      () => new Date('2026-04-29T10:00:00.000Z'),
    );

    await service.notifySenderOfMissedCheckIn({ receiverId: 'receiver-deleted', checkInId: 'check-in-1' });

    expect(notifications.sent).toEqual([]);
    expect(audit.events).toEqual([]);
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
