import { ActorType, SensitiveAction } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { AccountDeletionResult, AccountExportRecord, AccountRepository } from './account.repository';
import { AccountPrivacyService } from './account-privacy.service';
import { StepUpService } from './step-up.service';

class FakeStepUpService {
  public consumed: Array<{ userId: string; action: SensitiveAction; stepUpToken: string }> = [];

  async consumeStepUpToken(input: { userId: string; action: SensitiveAction; stepUpToken: string }) {
    this.consumed.push(input);
    if (input.stepUpToken !== `${input.action}-token`) {
      throw new Error('Step-up verification is required');
    }
  }
}

class FakeAccountRepository implements Partial<AccountRepository> {
  public deletedInput: unknown;

  constructor(public exportRecord: AccountExportRecord | null, private readonly deleteResult: AccountDeletionResult | null = null) {}

  async buildExport() {
    return this.exportRecord;
  }

  async deleteAccountData(input: unknown) {
    this.deletedInput = input;
    return this.deleteResult;
  }
}

class FakeAuditService {
  public events: unknown[] = [];

  async append(input: unknown) {
    this.events.push(input);
  }
}

const cryptoService = new CryptoService(Buffer.alloc(32, 7));

function encrypted(value: string): string {
  return cryptoService.encrypt(value);
}

function exportRecord(): AccountExportRecord {
  return {
    user: {
      id: 'user-1',
      emailEncrypted: encrypted('sender@example.com'),
      phoneEncrypted: encrypted('+971501234567'),
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    },
    receivers: [
      {
        id: 'receiver-1',
        nameEncrypted: encrypted('Salma'),
        phoneEncrypted: encrypted('+919876543210'),
        countryCode: 'IN',
        relationshipType: 'PARENT',
        language: 'ml',
        timezone: 'Asia/Kolkata',
        techProfile: 'WHATSAPP',
        primaryChannel: 'WHATSAPP',
        fallbackChannels: ['SMS', 'VOICE'],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: 'GRANTED',
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
    ],
    backupContacts: [
      {
        id: 'backup-1',
        receiverId: 'receiver-1',
        nameEncrypted: encrypted('Fatima'),
        phoneEncrypted: encrypted('+919111111111'),
        relationshipToReceiver: 'Cousin',
        locationInstructionsEncrypted: encrypted('Blue gate'),
        priorityOrder: 0,
        createdAt: new Date('2026-04-05T00:00:00.000Z'),
      },
    ],
    checkIns: [{ id: 'check-1', receiverId: 'receiver-1', status: 'RESPONDED_OK', responseTranscript: encrypted('OK') }],
    attempts: [{ id: 'attempt-1', providerMessageId: 'SM123', providerStatus: 'accepted' }],
    escalations: [{ id: 'escalation-1', errorDetails: 'sanitized' }],
    subscriptions: [{ id: 'sub-1', paymentProvider: 'stripe', externalSubscriptionId: 'sub_external' }],
    auditLogs: [{ id: 'audit-1', action: 'receiver.created', metadata: { receiverId: 'receiver-1' } }],
  };
}

describe('AccountPrivacyService', () => {
  it('exports decrypted sender-owned data and excludes internal sensitive fields', async () => {
    const stepUp = new FakeStepUpService();
    const service = new AccountPrivacyService(
      new FakeAccountRepository(exportRecord()) as unknown as AccountRepository,
      stepUp as unknown as StepUpService,
      cryptoService,
      new FakeAuditService() as unknown as AuditService,
      () => new Date('2026-05-01T10:00:00.000Z'),
    );

    const result = await service.exportAccount({ userId: 'user-1', stepUpToken: 'EXPORT_DATA-token' });
    const serialized = JSON.stringify(result);

    expect(stepUp.consumed).toEqual([{ userId: 'user-1', action: SensitiveAction.EXPORT_DATA, stepUpToken: 'EXPORT_DATA-token' }]);
    expect(result.user.email).toBe('sender@example.com');
    expect(result.receivers[0]?.displayName).toBe('Salma');
    expect(result.backupContacts[0]?.displayName).toBe('Fatima');
    expect(serialized).not.toContain('Encrypted');
    expect(serialized).not.toContain('phoneHash');
    expect(serialized).not.toContain('providerMessageId');
    expect(serialized).not.toContain('SM123');
  });

  it('requires a DELETE_ACCOUNT token, anonymizes account data, and appends a safe audit event', async () => {
    const stepUp = new FakeStepUpService();
    const audit = new FakeAuditService();
    const repository = new FakeAccountRepository(exportRecord(), {
      deletedAt: new Date('2026-05-01T10:00:00.000Z'),
      receiverCount: 1,
      backupContactCount: 1,
    });
    const service = new AccountPrivacyService(
      repository as unknown as AccountRepository,
      stepUp as unknown as StepUpService,
      cryptoService,
      audit as unknown as AuditService,
      () => new Date('2026-05-01T10:00:00.000Z'),
    );

    const result = await service.deleteAccount({
      userId: 'user-1',
      stepUpToken: 'DELETE_ACCOUNT-token',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result).toEqual({ ok: true, deletedAt: '2026-05-01T10:00:00.000Z' });
    expect(stepUp.consumed).toEqual([{ userId: 'user-1', action: SensitiveAction.DELETE_ACCOUNT, stepUpToken: 'DELETE_ACCOUNT-token' }]);
    expect(JSON.stringify(repository.deletedInput)).not.toContain('sender@example.com');
    expect(audit.events).toEqual([
      {
        entityType: 'user',
        entityId: 'user-1',
        action: 'account.deleted',
        actorType: ActorType.USER,
        actorId: 'user-1',
        metadata: { receiverCount: 1, backupCount: 1 },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    ]);
  });

  it('rejects export when the step-up token is scoped to another action', async () => {
    const service = new AccountPrivacyService(
      new FakeAccountRepository(exportRecord()) as unknown as AccountRepository,
      new FakeStepUpService() as unknown as StepUpService,
      cryptoService,
      new FakeAuditService() as unknown as AuditService,
    );

    await expect(service.exportAccount({ userId: 'user-1', stepUpToken: 'DELETE_ACCOUNT-token' })).rejects.toThrow('Step-up verification is required');
  });
});
