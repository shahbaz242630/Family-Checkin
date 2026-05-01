import type { SensitiveAction } from '@prisma/client';

export interface StepUpChallengeRecord {
  id: string;
  userId: string;
  action: SensitiveAction;
  codeHash: string;
  tokenHash?: string;
  expiresAt: Date;
  verifiedAt?: Date;
  tokenExpiresAt?: Date;
  consumedAt?: Date;
  attemptCount: number;
  createdAt: Date;
}

export interface AccountExportRecord {
  user: {
    id: string;
    emailEncrypted: string;
    phoneEncrypted: string;
    country: string;
    preferredLanguage: string;
    timezone: string;
    createdAt: Date;
    updatedAt: Date;
  };
  receivers: Array<{
    id: string;
    nameEncrypted: string;
    phoneEncrypted: string;
    countryCode: string;
    relationshipType: string;
    language: string;
    timezone: string;
    techProfile: string;
    primaryChannel: string;
    fallbackChannels: string[];
    scheduleFrequency: string;
    scheduleTimeWindow: unknown;
    pausedUntil?: Date;
    pausedReason?: string;
    consentStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  backupContacts: Array<{
    id: string;
    receiverId: string;
    nameEncrypted: string;
    phoneEncrypted: string;
    relationshipToReceiver: string;
    locationInstructionsEncrypted?: string;
    priorityOrder: number;
    createdAt: Date;
  }>;
  checkIns: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
}

export interface AccountDeletionResult {
  deletedAt: Date;
  receiverCount: number;
  backupContactCount: number;
}

export interface AccountRepository {
  createStepUpChallenge(
    input: Omit<StepUpChallengeRecord, 'verifiedAt' | 'tokenHash' | 'tokenExpiresAt' | 'consumedAt' | 'attemptCount' | 'createdAt'>,
  ): Promise<StepUpChallengeRecord>;
  findStepUpChallengeById(id: string): Promise<StepUpChallengeRecord | null>;
  incrementStepUpAttempts(id: string): Promise<StepUpChallengeRecord>;
  markStepUpVerified(input: { id: string; tokenHash: string; verifiedAt: Date; tokenExpiresAt: Date }): Promise<StepUpChallengeRecord>;
  consumeStepUpToken(input: {
    userId: string;
    action: SensitiveAction;
    tokenHash: string;
    consumedAt: Date;
  }): Promise<StepUpChallengeRecord | null>;
  buildExport(userId: string): Promise<AccountExportRecord | null>;
  deleteAccountData(input: {
    userId: string;
    deletedAt: Date;
    anonymizedUserEmailEncrypted: string;
    anonymizedUserPhoneEncrypted: string;
    anonymizedUserEmailHash: string;
    anonymizedUserPhoneHash: string;
    anonymizedReceiverNameEncrypted: string;
    anonymizedReceiverPhoneEncrypted: string;
    anonymizedReceiverPhoneHash: string;
    anonymizedBackupNameEncrypted: string;
    anonymizedBackupPhoneEncrypted: string;
    anonymizedBackupPhoneHash: string;
  }): Promise<AccountDeletionResult | null>;
}
