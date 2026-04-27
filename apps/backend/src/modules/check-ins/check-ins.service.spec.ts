import { ActorType, Channel, CheckInStatus, ConsentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { ChannelRouterService } from '../channels/channel-router.service';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type {
  CheckInRecord,
  CheckInReceiverCandidate,
  CheckInsRepository,
  CreatePendingCheckInInput,
  MarkCheckInSentInput,
  MarkCheckInRespondedInput,
} from './check-ins.repository';
import { CheckInsService } from './check-ins.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryCheckInsRepository implements CheckInsRepository {
  public candidates: CheckInReceiverCandidate[] = [];
  public created: CreatePendingCheckInInput[] = [];
  public sent: MarkCheckInSentInput[] = [];

  async findReceiversDueForCheckIn(_now: Date): Promise<CheckInReceiverCandidate[]> {
    return this.candidates;
  }

  async createPending(input: CreatePendingCheckInInput): Promise<CheckInRecord> {
    this.created.push(input);

    return {
      id: `check-in-${this.created.length}`,
      receiverId: input.receiverId,
      scheduledAt: input.scheduledAt,
      status: CheckInStatus.PENDING,
      createdAt: input.scheduledAt,
      updatedAt: input.scheduledAt,
    };
  }

  async markSent(input: MarkCheckInSentInput): Promise<CheckInRecord> {
    this.sent.push(input);

    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: CheckInStatus.SENT,
      channelUsed: input.channel,
      sentAt: input.sentAt,
      createdAt: input.sentAt,
      updatedAt: input.sentAt,
    };
  }

  async findLatestOpenForReceiver(_receiverId: string): Promise<CheckInRecord | null> {
    return null;
  }

  async markResponded(input: MarkCheckInRespondedInput): Promise<CheckInRecord> {
    return {
      id: input.checkInId,
      receiverId: 'receiver-1',
      scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      status: input.status,
      respondedAt: input.respondedAt,
      responseDetectedAs: input.responseDetectedAs,
      responseTranscript: input.responseTranscript,
      createdAt: input.respondedAt,
      updatedAt: input.respondedAt,
    };
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: `audit-${this.events.length}`,
      createdAt: new Date('2026-04-27T05:30:00.000Z'),
      ...input,
    };
  }
}

describe('CheckInsService', () => {
  it('creates, sends, marks sent, and audits a due receiver with granted consent', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      now: () => new Date('2026-04-27T05:30:00.000Z'),
    });
    repository.candidates = [receiverCandidate(crypto)];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      () => new Date('2026-04-27T05:30:00.000Z'),
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 1, sent: 1, skipped: 0 });
    expect(repository.created).toEqual([
      {
        receiverId: 'receiver-1',
        scheduledAt: new Date('2026-04-27T05:30:00.000Z'),
      },
    ]);
    expect(whatsapp.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'checkin_daily',
          language: 'en',
          variables: {},
        },
      },
    ]);
    expect(repository.sent).toEqual([
      {
        checkInId: 'check-in-1',
        channel: Channel.WHATSAPP,
        sentAt: new Date('2026-04-27T05:30:00.000Z'),
        providerMessageId: 'fake-WHATSAPP-message-1',
        providerStatus: 'accepted',
      },
    ]);
    expect(audit.events).toEqual([
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.created',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          scheduleFrequency: 'daily',
        },
      },
      {
        entityType: 'check_in',
        entityId: 'check-in-1',
        action: 'check_in.sent',
        actorType: ActorType.SYSTEM,
        metadata: {
          receiverId: 'receiver-1',
          channel: Channel.WHATSAPP,
          providerStatus: 'accepted',
        },
      },
    ]);
  });

  it('skips candidates that are not currently eligible for a check-in', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryCheckInsRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP);
    repository.candidates = [
      { ...receiverCandidate(crypto), id: 'pending-receiver', consentStatus: ConsentStatus.PENDING },
      { ...receiverCandidate(crypto), id: 'paused-receiver', pausedUntil: new Date('2026-04-28T00:00:00.000Z') },
      { ...receiverCandidate(crypto), id: 'deleted-receiver', deletedAt: new Date('2026-04-26T00:00:00.000Z') },
    ];
    const service = new CheckInsService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      () => new Date('2026-04-27T05:30:00.000Z'),
    );

    const result = await service.sendDueCheckIns();

    expect(result).toEqual({ created: 0, sent: 0, skipped: 3 });
    expect(repository.created).toEqual([]);
    expect(repository.sent).toEqual([]);
    expect(whatsapp.sentMessages).toEqual([]);
    expect(audit.events).toEqual([]);
  });
});

function receiverCandidate(crypto: CryptoService): CheckInReceiverCandidate {
  return {
    id: 'receiver-1',
    phoneEncrypted: crypto.encrypt('+971501234567'),
    language: 'en',
    timezone: 'Asia/Dubai',
    primaryChannel: Channel.WHATSAPP,
    scheduleFrequency: 'daily',
    scheduleTimeWindow: {
      start: '09:00',
      end: '11:00',
    },
    consentStatus: ConsentStatus.GRANTED,
  };
}
