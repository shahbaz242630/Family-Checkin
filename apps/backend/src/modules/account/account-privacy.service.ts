import { ActorType, SensitiveAction } from '@prisma/client';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../shared/crypto/crypto.service';
import type { AccountExportRecord, AccountRepository } from './account.repository';
import { ACCOUNT_REPOSITORY } from './account.tokens';
import { StepUpService } from './step-up.service';

export interface AccountExportResponse {
  exportedAt: string;
  exportVersion: '2026-05-01';
  user: {
    id: string;
    email: string;
    phone: string;
    /** Present when the sender has a stored display name (CB-010). */
    displayName?: string;
    country: string;
    preferredLanguage: string;
    timezone: string;
    createdAt: string;
    updatedAt: string;
  };
  receivers: Array<Record<string, unknown>>;
  backupContacts: Array<Record<string, unknown>>;
  checkIns: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
}

@Injectable()
export class AccountPrivacyService {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepository: AccountRepository,
    @Inject(StepUpService)
    private readonly stepUpService: StepUpService,
    @Inject(CryptoService)
    private readonly cryptoService: CryptoService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async exportAccount(input: { userId: string; stepUpToken: string }): Promise<AccountExportResponse> {
    await this.stepUpService.consumeStepUpToken({
      userId: input.userId,
      action: SensitiveAction.EXPORT_DATA,
      stepUpToken: input.stepUpToken,
    });

    const exportRecord = await this.accountRepository.buildExport(input.userId);
    if (!exportRecord) {
      throw new NotFoundException('Account not found');
    }

    return this.toExportResponse(exportRecord, this.now());
  }

  async deleteAccount(input: {
    userId: string;
    stepUpToken: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ ok: true; deletedAt: string }> {
    await this.stepUpService.consumeStepUpToken({
      userId: input.userId,
      action: SensitiveAction.DELETE_ACCOUNT,
      stepUpToken: input.stepUpToken,
    });

    const deletedAt = this.now();
    const deleted = await this.accountRepository.deleteAccountData({
      userId: input.userId,
      deletedAt,
      anonymizedUserEmailEncrypted: this.cryptoService.encrypt(`deleted-${input.userId}@nearby.invalid`),
      anonymizedUserPhoneEncrypted: this.cryptoService.encrypt(`deleted:${input.userId}`),
      anonymizedUserEmailHash: this.cryptoService.hashForLookup(`deleted-email:${input.userId}`),
      anonymizedUserPhoneHash: this.cryptoService.hashForLookup(`deleted-phone:${input.userId}`),
      anonymizedReceiverNameEncrypted: this.cryptoService.encrypt('Deleted receiver'),
      anonymizedReceiverPhoneEncrypted: this.cryptoService.encrypt('deleted'),
      anonymizedReceiverPhoneHash: this.cryptoService.hashForLookup(`deleted-receiver:${input.userId}`),
      anonymizedBackupNameEncrypted: this.cryptoService.encrypt('Deleted backup contact'),
      anonymizedBackupPhoneEncrypted: this.cryptoService.encrypt('deleted'),
      anonymizedBackupPhoneHash: this.cryptoService.hashForLookup(`deleted-backup:${input.userId}`),
    });

    if (!deleted) {
      throw new NotFoundException('Account not found');
    }

    await this.auditService.append({
      entityType: 'user',
      entityId: input.userId,
      action: 'account.deleted',
      actorType: ActorType.USER,
      actorId: input.userId,
      metadata: {
        receiverCount: deleted.receiverCount,
        backupCount: deleted.backupContactCount,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { ok: true, deletedAt: deleted.deletedAt.toISOString() };
  }

  private toExportResponse(record: AccountExportRecord, exportedAt: Date): AccountExportResponse {
    return {
      exportedAt: exportedAt.toISOString(),
      exportVersion: '2026-05-01',
      user: {
        id: record.user.id,
        email: this.cryptoService.decrypt(record.user.emailEncrypted),
        phone: this.cryptoService.decrypt(record.user.phoneEncrypted),
        ...(record.user.displayNameEncrypted
          ? { displayName: this.cryptoService.decrypt(record.user.displayNameEncrypted) }
          : {}),
        country: record.user.country,
        preferredLanguage: record.user.preferredLanguage,
        timezone: record.user.timezone,
        createdAt: record.user.createdAt.toISOString(),
        updatedAt: record.user.updatedAt.toISOString(),
      },
      receivers: record.receivers.map((receiver) => ({
        id: receiver.id,
        displayName: this.cryptoService.decrypt(receiver.nameEncrypted),
        phone: this.cryptoService.decrypt(receiver.phoneEncrypted),
        countryCode: receiver.countryCode,
        relationshipType: receiver.relationshipType,
        language: receiver.language,
        timezone: receiver.timezone,
        techProfile: receiver.techProfile,
        primaryChannel: receiver.primaryChannel,
        fallbackChannels: receiver.fallbackChannels,
        scheduleFrequency: receiver.scheduleFrequency,
        scheduleTimeWindow: receiver.scheduleTimeWindow,
        pausedUntil: receiver.pausedUntil?.toISOString(),
        pausedReason: receiver.pausedReason,
        consentStatus: receiver.consentStatus,
        createdAt: receiver.createdAt.toISOString(),
        updatedAt: receiver.updatedAt.toISOString(),
      })),
      backupContacts: record.backupContacts.map((contact) => ({
        id: contact.id,
        receiverId: contact.receiverId,
        displayName: this.cryptoService.decrypt(contact.nameEncrypted),
        phone: this.cryptoService.decrypt(contact.phoneEncrypted),
        relationshipToReceiver: contact.relationshipToReceiver,
        locationInstructions: contact.locationInstructionsEncrypted
          ? this.cryptoService.decrypt(contact.locationInstructionsEncrypted)
          : undefined,
        priorityOrder: contact.priorityOrder,
        createdAt: contact.createdAt.toISOString(),
      })),
      checkIns: record.checkIns.map((checkIn) => this.stripInternalFields(checkIn)),
      attempts: record.attempts.map((attempt) => this.stripInternalFields(attempt)),
      escalations: record.escalations.map((escalation) => this.stripInternalFields(escalation)),
      subscriptions: record.subscriptions.map((subscription) => this.stripInternalFields(subscription)),
      auditLogs: record.auditLogs.map((auditLog) => this.stripInternalFields(auditLog)),
    };
  }

  private stripInternalFields(record: Record<string, unknown>): Record<string, unknown> {
    const blocked = new Set([
      'emailEncrypted',
      'phoneEncrypted',
      'nameEncrypted',
      'phoneHash',
      'emailHash',
      'providerMessageId',
      'providerPayload',
      'responseTranscript',
      'externalSubscriptionId',
    ]);

    return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
  }
}
