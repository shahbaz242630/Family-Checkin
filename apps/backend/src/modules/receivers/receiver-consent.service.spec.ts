import { AbuseReportStatus, ActorType, Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import { ChannelRouterService } from '../channels/channel-router.service';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { CreateReceiverRecordInput, ReceiverRecord, ReceiversRepository, UpdateReceiverRecordInput } from './receivers.repository';
import { ReceiverConsentService } from './receiver-consent.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public markedConsentRequest: { receiverId: string; consentRequestedAt: Date; consentTranscript: string } | null = null;

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    return this.record(input);
  }

  async findActiveByPhoneHash(_phoneHash: string): Promise<ReceiverRecord | null> {
    return null;
  }

  async findManyForUser(_userId: string): Promise<ReceiverRecord[]> {
    return [];
  }

  async findForUserById(_input: { userId: string; receiverId: string }): Promise<ReceiverRecord | null> {
    return null;
  }

  async updateForUserById(_input: UpdateReceiverRecordInput): Promise<ReceiverRecord | null> {
    return null;
  }

  async pauseForUserById(_input: {
    userId: string;
    receiverId: string;
    pausedUntil: Date;
    pausedReason: string;
  }): Promise<ReceiverRecord | null> {
    return null;
  }

  async resumeForUserById(_input: { userId: string; receiverId: string }): Promise<ReceiverRecord | null> {
    return null;
  }

  async markConsentRequested(input: {
    receiverId: string;
    consentRequestedAt: Date;
    consentTranscript: string;
  }): Promise<ReceiverRecord> {
    this.markedConsentRequest = input;
    return {
      ...receiverFixture(new CryptoService(masterKey)),
      consentRequestedAt: input.consentRequestedAt,
      consentTranscript: input.consentTranscript,
    };
  }

  async updateConsentResponse(input: {
    receiverId: string;
    consentStatus: ConsentStatus;
    consentTranscript: string;
    consentGrantedAt?: Date;
    consentRevokedAt?: Date;
  }): Promise<ReceiverRecord> {
    return {
      ...receiverFixture(new CryptoService(masterKey)),
      id: input.receiverId,
      consentStatus: input.consentStatus,
      consentTranscript: input.consentTranscript,
      consentGrantedAt: input.consentGrantedAt,
      consentRevokedAt: input.consentRevokedAt,
    };
  }

  async upsertOptOutCooldown(_input: {
    receiverId: string;
    optOutAt: Date;
    cooldownUntil: Date;
    optOutChannel: Channel;
    optOutKeyword?: string;
  }): Promise<void> {}

  async createAbuseReport(input: {
    receiverId: string;
    reporterPhoneHash: string;
    reportContent?: string;
    reportedAt: Date;
  }): Promise<{ id: string; receiverId: string; reviewStatus: AbuseReportStatus; reportedAt: Date }> {
    return {
      id: 'abuse-report-1',
      receiverId: input.receiverId,
      reviewStatus: AbuseReportStatus.PENDING,
      reportedAt: input.reportedAt,
    };
  }

  async pauseForAbuseReview(input: { receiverId: string; pausedReason: string }): Promise<ReceiverRecord> {
    return {
      ...receiverFixture(new CryptoService(masterKey)),
      id: input.receiverId,
      pausedReason: input.pausedReason,
    };
  }

  private record(input: CreateReceiverRecordInput): ReceiverRecord {
    return {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }
}

class InMemoryAuditService {
  public events: AppendAuditLogInput[] = [];

  async append(input: AppendAuditLogInput) {
    this.events.push(input);
    return {
      id: '04dc851f-5cb1-4d3c-9d6b-1b015b9af62f',
      createdAt: new Date('2026-04-26T10:00:00.000Z'),
      ...input,
    };
  }
}

describe('ReceiverConsentService', () => {
  it('sends a message consent request, persists encrypted transcript, and audits safely', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, {
      now: () => new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverConsentService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      () => new Date('2026-04-26T10:00:00.000Z'),
    );

    await service.requestConsent({
      receiver: receiverFixture(crypto),
      actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      senderDisplayName: 'Ahmed',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(whatsapp.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'consent_request',
          language: 'en',
          variables: {
            senderDisplayName: 'Ahmed',
            receiverDisplayName: 'Fatima Parent',
          },
        },
      },
    ]);
    expect(repository.markedConsentRequest?.receiverId).toBe('1aef91f9-64c9-4548-baa5-d70b52386efb');
    expect(repository.markedConsentRequest?.consentRequestedAt).toEqual(new Date('2026-04-26T10:00:00.000Z'));
    const transcript = JSON.parse(crypto.decrypt(repository.markedConsentRequest?.consentTranscript ?? ''));
    expect(transcript).toMatchObject({
      channel: Channel.WHATSAPP,
      templateKey: 'consent_request',
      providerMessageId: 'fake-WHATSAPP-message-1',
    });
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.consent_requested',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          channel: Channel.WHATSAPP,
          templateKey: 'consent_request',
          providerStatus: 'accepted',
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('uses a voice call for voice-only consent requests', async () => {
    const crypto = new CryptoService(masterKey);
    const voice = new FakeChannelProvider(Channel.VOICE, {
      now: () => new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverConsentService(
      new InMemoryReceiversRepository(),
      crypto,
      new ChannelRouterService([voice]),
      new InMemoryAuditService() as unknown as AuditService,
      () => new Date('2026-04-26T10:00:00.000Z'),
    );

    await service.requestConsent({
      receiver: {
        ...receiverFixture(crypto),
        primaryChannel: Channel.VOICE,
        techProfile: TechProfile.VOICE_ONLY,
        fallbackChannels: [],
      },
      actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      senderDisplayName: 'Ahmed',
    });

    expect(voice.voiceCalls).toEqual([
      {
        to: '+971501234567',
        script: {
          scriptKey: 'consent_request_voice',
          language: 'en',
          variables: {
            senderDisplayName: 'Ahmed',
            receiverDisplayName: 'Fatima Parent',
          },
        },
      },
    ]);
  });

  it('does not send duplicate consent requests after consent has already been requested', async () => {
    const crypto = new CryptoService(masterKey);
    const service = new ReceiverConsentService(
      new InMemoryReceiversRepository(),
      crypto,
      new ChannelRouterService([new FakeChannelProvider(Channel.WHATSAPP)]),
      new InMemoryAuditService() as unknown as AuditService,
    );

    await expect(
      service.requestConsent({
        receiver: {
          ...receiverFixture(crypto),
          consentRequestedAt: new Date('2026-04-26T10:00:00.000Z'),
        },
        actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        senderDisplayName: 'Ahmed',
      }),
    ).rejects.toThrow('Receiver consent has already been requested');
  });
});

function receiverFixture(crypto: CryptoService): ReceiverRecord {
  return {
    id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    nameEncrypted: crypto.encrypt('Fatima Parent'),
    phoneEncrypted: crypto.encrypt('+971501234567'),
    phoneHash: crypto.hashForLookup('+971501234567'),
    countryCode: 'AE',
    relationshipType: RelationshipType.PARENT,
    language: 'en',
    timezone: 'Asia/Dubai',
    techProfile: TechProfile.WHATSAPP,
    primaryChannel: Channel.WHATSAPP,
    fallbackChannels: [Channel.SMS, Channel.VOICE],
    scheduleFrequency: 'daily',
    scheduleTimeWindow: {
      start: '09:00',
      end: '11:00',
    },
    consentStatus: ConsentStatus.PENDING,
    createdAt: new Date('2026-04-26T10:00:00.000Z'),
    updatedAt: new Date('2026-04-26T10:00:00.000Z'),
  };
}
