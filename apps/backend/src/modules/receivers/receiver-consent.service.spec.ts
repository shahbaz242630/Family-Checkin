import { AbuseReportStatus, ActorType, Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from '../channels/fake-channel.provider';
import { ChannelRouterService } from '../channels/channel-router.service';
import type { AppendAuditLogInput } from '../audit/audit.repository';
import type { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { ConsentNotPendingError, ConsentResendLimitError, OptOutCooldownError } from './receiver-policy';
import type {
  CreateReceiverRecordInput,
  OptOutCooldownRecord,
  ReceiverRecord,
  ReceiversRepository,
  UpdateReceiverRecordInput,
} from './receivers.repository';
import { ReceiverConsentService } from './receiver-consent.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryReceiversRepository implements ReceiversRepository {
  public markedConsentRequest: { receiverId: string; consentRequestedAt: Date; consentTranscript: string } | null =
    null;
  /** The sender-scoped row `resendConsent` looks up. */
  public receiverForUser: ReceiverRecord | null = null;
  public optOutCooldown: OptOutCooldownRecord | null = null;

  async create(input: CreateReceiverRecordInput): Promise<ReceiverRecord> {
    return this.record(input);
  }

  async findActiveByPhoneHash(_phoneHash: string): Promise<ReceiverRecord | null> {
    return null;
  }

  async findManyActiveByPhoneHash(_phoneHash: string): Promise<ReceiverRecord[]> {
    return [];
  }

  async findActiveById(_receiverId: string): Promise<ReceiverRecord | null> {
    return null;
  }

  async findOptOutCooldownByPhoneHash(_phoneHash: string): Promise<OptOutCooldownRecord | null> {
    return this.optOutCooldown;
  }

  async setCheckInResolutionNote(): Promise<void> {}

  async findManyForUser(_userId: string): Promise<ReceiverRecord[]> {
    return [];
  }

  async findForUserById(input: { userId: string; receiverId: string }): Promise<ReceiverRecord | null> {
    return this.receiverForUser?.id === input.receiverId && this.receiverForUser.userId === input.userId
      ? this.receiverForUser
      : null;
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

  async deleteForUserById(_input: {
    userId: string;
    receiverId: string;
    deletedAt: Date;
  }): Promise<ReceiverRecord | null> {
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

  async resolveCheckInForUserById(): Promise<null> {
    return null;
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
            receiverName: 'Fatima Parent',
            senderDisplayName: 'Ahmed',
          },
        },
      },
    ]);
    expect(whatsapp.renderedMessages[0]?.body).toBe(
      'Hi Fatima Parent, Ahmed asked Nearby to check in on you with a short daily message. Reply YES to agree. ' +
        'Reply STOP to stop, REPORT to report.',
    );
    expect(repository.markedConsentRequest?.receiverId).toBe('1aef91f9-64c9-4548-baa5-d70b52386efb');
    expect(repository.markedConsentRequest?.consentRequestedAt).toEqual(new Date('2026-04-26T10:00:00.000Z'));
    const transcript = JSON.parse(crypto.decrypt(repository.markedConsentRequest?.consentTranscript ?? ''));
    expect(transcript).toMatchObject({
      channel: Channel.WHATSAPP,
      templateKey: 'consent_request',
      providerMessageId: 'fake-WHATSAPP-message-1',
      renderedLanguage: 'en',
      renderFallback: false,
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

  it('names the sender from UsersService when a display name is stored and keeps the caller wording otherwise (CB-010)', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const whatsapp = new FakeChannelProvider(Channel.WHATSAPP, { now: () => new Date('2026-04-26T10:00:00.000Z') });
    const displayNames = new Map<string, string>([['61a5639c-c902-4950-9924-1a4d6db1e02d', 'Sam']]);
    const users = {
      lookedUp: [] as Array<{ userId: string; fallback?: string }>,
      async senderDisplayNameFor(userId: string, fallback?: string) {
        users.lookedUp.push({ userId, fallback });
        return displayNames.get(userId) ?? fallback ?? 'your family member';
      },
    };
    const service = new ReceiverConsentService(
      repository,
      crypto,
      new ChannelRouterService([whatsapp]),
      audit as unknown as AuditService,
      () => new Date('2026-04-26T10:00:00.000Z'),
      users,
    );
    const receiver = receiverFixture(crypto);

    await service.requestConsent({
      receiver,
      actorUserId: receiver.userId,
      senderDisplayName: 'your family member',
    });
    displayNames.clear();
    await service.requestConsent({
      receiver: { ...receiver, id: 'receiver-2' },
      actorUserId: receiver.userId,
      senderDisplayName: 'your family member',
    });

    expect(whatsapp.sentMessages.map((sent) => sent.message.variables.senderDisplayName)).toEqual([
      'Sam',
      'your family member',
    ]);
    expect(whatsapp.renderedMessages[0]?.body).toContain('Sam');
    expect(users.lookedUp).toEqual([
      { userId: receiver.userId, fallback: 'your family member' },
      { userId: receiver.userId, fallback: 'your family member' },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('Sam');
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

  it('carries the personal note into the consent request and records the English fallback for other languages', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const sms = new FakeChannelProvider(Channel.SMS, {
      now: () => new Date('2026-04-26T10:00:00.000Z'),
    });
    const service = new ReceiverConsentService(
      repository,
      crypto,
      new ChannelRouterService([sms]),
      audit as unknown as AuditService,
      () => new Date('2026-04-26T10:00:00.000Z'),
    );

    await service.requestConsent({
      receiver: {
        ...receiverFixture(crypto),
        primaryChannel: Channel.SMS,
        language: 'ar',
        personalNoteEncrypted: crypto.encrypt('Call me after lunch'),
      },
      actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      senderDisplayName: 'Ahmed',
    });

    expect(sms.sentMessages[0]?.message.variables).toEqual({
      receiverName: 'Fatima Parent',
      senderDisplayName: 'Ahmed',
      personalNote: 'Call me after lunch',
    });
    expect(sms.renderedMessages[0]).toMatchObject({ language: 'en', fallback: true });
    expect(sms.renderedMessages[0]?.body).toContain('Their note: "Call me after lunch"');
    const transcript = JSON.parse(crypto.decrypt(repository.markedConsentRequest?.consentTranscript ?? ''));
    expect(transcript).toMatchObject({ renderedLanguage: 'en', renderFallback: true });
    expect(JSON.stringify(audit.events)).not.toContain('Call me after lunch');
  });

  it('leaves consentRequestedAt unset and audits when the consent send fails, so a resend stays possible (CB-009)', async () => {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    // Only SMS is wired; the receiver's primary channel is WhatsApp, so the router has no provider for it.
    const service = new ReceiverConsentService(
      repository,
      crypto,
      new ChannelRouterService([new FakeChannelProvider(Channel.SMS)]),
      audit as unknown as AuditService,
      () => new Date('2026-04-26T10:00:00.000Z'),
    );

    const receiver = await service.requestConsent({
      receiver: receiverFixture(crypto),
      actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      senderDisplayName: 'Ahmed',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });

    expect(receiver.consentRequestedAt).toBeUndefined();
    expect(repository.markedConsentRequest).toBeNull();
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.consent_request_failed',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          channel: Channel.WHATSAPP,
          templateKey: 'consent_request',
          error: expect.any(String),
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
    expect(JSON.stringify(audit.events)).not.toContain('+971501234567');
  });
});

describe('ReceiverConsentService resends a consent request at most once per 7 days (CB-009)', () => {
  const now = () => new Date('2026-05-10T10:00:00.000Z');
  const resendInput = {
    userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    senderDisplayName: 'your family member',
    ipAddress: '203.0.113.10',
    userAgent: 'Nearby Mobile/1.0',
  };

  function harness(receiver: ReceiverRecord | null, providerChannel: Channel = Channel.WHATSAPP) {
    const crypto = new CryptoService(masterKey);
    const repository = new InMemoryReceiversRepository();
    const audit = new InMemoryAuditService();
    const provider = new FakeChannelProvider(providerChannel, { now });
    repository.receiverForUser = receiver;
    const service = new ReceiverConsentService(
      repository,
      crypto,
      new ChannelRouterService([provider]),
      audit as unknown as AuditService,
      now,
    );

    return { crypto, repository, audit, provider, service };
  }

  it('resends to a pending receiver whose first request never went out and marks it requested', async () => {
    const crypto = new CryptoService(masterKey);
    const { repository, audit, provider, service } = harness(receiverFixture(crypto));

    const result = await service.resendConsent(resendInput);

    expect(provider.sentMessages).toEqual([
      {
        to: '+971501234567',
        message: {
          templateKey: 'consent_request',
          language: 'en',
          variables: { receiverName: 'Fatima Parent', senderDisplayName: 'your family member' },
        },
      },
    ]);
    expect(repository.markedConsentRequest).toMatchObject({
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      consentRequestedAt: new Date('2026-05-10T10:00:00.000Z'),
    });
    expect(result?.sent).toBe(true);
    expect(result?.receiver.consentRequestedAt).toEqual(new Date('2026-05-10T10:00:00.000Z'));
    const transcript = JSON.parse(crypto.decrypt(repository.markedConsentRequest?.consentTranscript ?? ''));
    expect(transcript).toMatchObject({ resend: true, channel: Channel.WHATSAPP, templateKey: 'consent_request' });
    expect(audit.events).toEqual([
      {
        entityType: 'receiver',
        entityId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        action: 'receiver.consent_resent',
        actorType: ActorType.USER,
        actorId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        metadata: {
          channel: Channel.WHATSAPP,
          templateKey: 'consent_request',
          providerStatus: 'accepted',
          previousRequestAt: undefined,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'Nearby Mobile/1.0',
      },
    ]);
  });

  it('resends once the previous request is at least 7 days old', async () => {
    const crypto = new CryptoService(masterKey);
    const { provider, audit, service } = harness({
      ...receiverFixture(crypto),
      consentRequestedAt: new Date('2026-05-03T10:00:00.000Z'),
    });

    await service.resendConsent(resendInput);

    expect(provider.sentMessages).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'receiver.consent_resent',
      metadata: { previousRequestAt: '2026-05-03T10:00:00.000Z' },
    });
  });

  it('refuses a second invitation inside 7 days with the time the next one is allowed', async () => {
    const crypto = new CryptoService(masterKey);
    const { provider, repository, service } = harness({
      ...receiverFixture(crypto),
      consentRequestedAt: new Date('2026-05-08T10:00:00.000Z'),
    });

    const error = await service.resendConsent(resendInput).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConsentResendLimitError);
    expect((error as ConsentResendLimitError).nextAllowedAt).toEqual(new Date('2026-05-15T10:00:00.000Z'));
    expect(provider.sentMessages).toEqual([]);
    expect(repository.markedConsentRequest).toBeNull();
  });

  it('refuses to re-invite a receiver who already answered', async () => {
    const crypto = new CryptoService(masterKey);
    const { provider, service } = harness({
      ...receiverFixture(crypto),
      consentStatus: ConsentStatus.DECLINED,
    });

    await expect(service.resendConsent(resendInput)).rejects.toBeInstanceOf(ConsentNotPendingError);
    expect(provider.sentMessages).toEqual([]);
  });

  it('refuses while the phone is inside a STOP cooldown', async () => {
    const crypto = new CryptoService(masterKey);
    const { repository, provider, service } = harness(receiverFixture(crypto));
    repository.optOutCooldown = {
      receiverId: 'some-earlier-row',
      optOutAt: new Date('2026-05-09T10:00:00.000Z'),
      cooldownUntil: new Date('2026-05-16T10:00:00.000Z'),
    };

    await expect(service.resendConsent(resendInput)).rejects.toBeInstanceOf(OptOutCooldownError);
    expect(provider.sentMessages).toEqual([]);
  });

  it('returns null for a receiver the sender does not own', async () => {
    const { service } = harness(null);

    await expect(service.resendConsent(resendInput)).resolves.toBeNull();
  });

  it('audits a failed resend and leaves the previous request time untouched', async () => {
    const crypto = new CryptoService(masterKey);
    // Provider wired for SMS only; the receiver's primary channel is WhatsApp.
    const { repository, audit, service } = harness(receiverFixture(crypto), Channel.SMS);

    const result = await service.resendConsent(resendInput);

    expect(result).toMatchObject({ sent: false });
    expect(result?.receiver.consentRequestedAt).toBeUndefined();
    expect(repository.markedConsentRequest).toBeNull();
    expect(audit.events).toEqual([
      expect.objectContaining({
        action: 'receiver.consent_resend_failed',
        metadata: { channel: Channel.WHATSAPP, templateKey: 'consent_request', error: expect.any(String) },
      }),
    ]);
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
