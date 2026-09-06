import { Inject, Injectable } from '@nestjs/common';
import type { SensitiveAction, StepUpChallenge } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AccountDeletionResult,
  AccountExportRecord,
  AccountRepository,
  StepUpChallengeRecord,
} from './account.repository';

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createStepUpChallenge(
    input: Omit<
      StepUpChallengeRecord,
      'verifiedAt' | 'tokenHash' | 'tokenExpiresAt' | 'consumedAt' | 'attemptCount' | 'createdAt'
    >,
  ): Promise<StepUpChallengeRecord> {
    return this.toStepUpChallengeRecord(
      await this.prisma.stepUpChallenge.create({
        data: input,
      }),
    );
  }

  async findStepUpChallengeById(id: string): Promise<StepUpChallengeRecord | null> {
    const challenge = await this.prisma.stepUpChallenge.findUnique({ where: { id } });
    return challenge ? this.toStepUpChallengeRecord(challenge) : null;
  }

  async incrementStepUpAttempts(id: string): Promise<StepUpChallengeRecord> {
    return this.toStepUpChallengeRecord(
      await this.prisma.stepUpChallenge.update({
        where: { id },
        data: { attemptCount: { increment: 1 } },
      }),
    );
  }

  async markStepUpVerified(input: {
    id: string;
    tokenHash: string;
    verifiedAt: Date;
    tokenExpiresAt: Date;
  }): Promise<StepUpChallengeRecord> {
    return this.toStepUpChallengeRecord(
      await this.prisma.stepUpChallenge.update({
        where: { id: input.id },
        data: {
          tokenHash: input.tokenHash,
          verifiedAt: input.verifiedAt,
          tokenExpiresAt: input.tokenExpiresAt,
        },
      }),
    );
  }

  async consumeStepUpToken(input: {
    userId: string;
    action: SensitiveAction;
    tokenHash: string;
    consumedAt: Date;
  }): Promise<StepUpChallengeRecord | null> {
    const challenge = await this.prisma.stepUpChallenge.findFirst({
      where: {
        userId: input.userId,
        action: input.action,
        tokenHash: input.tokenHash,
        consumedAt: null,
        tokenExpiresAt: { gt: input.consumedAt },
      },
    });

    if (!challenge) return null;

    return this.toStepUpChallengeRecord(
      await this.prisma.stepUpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: input.consumedAt },
      }),
    );
  }

  async buildExport(userId: string): Promise<AccountExportRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        emailEncrypted: true,
        phoneEncrypted: true,
        displayNameEncrypted: true,
        country: true,
        preferredLanguage: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) return null;

    const [receivers, backupContacts, checkIns, attempts, escalations, subscriptions, auditLogs] = await Promise.all([
      this.prisma.receiver.findMany({
        where: { userId },
        select: {
          id: true,
          nameEncrypted: true,
          phoneEncrypted: true,
          countryCode: true,
          relationshipType: true,
          language: true,
          timezone: true,
          techProfile: true,
          primaryChannel: true,
          fallbackChannels: true,
          scheduleFrequency: true,
          scheduleTimeWindow: true,
          pausedUntil: true,
          pausedReason: true,
          consentStatus: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.backupContact.findMany({
        where: { receiver: { userId } },
        select: {
          id: true,
          receiverId: true,
          nameEncrypted: true,
          phoneEncrypted: true,
          relationshipToReceiver: true,
          locationInstructionsEncrypted: true,
          priorityOrder: true,
          createdAt: true,
        },
      }),
      this.prisma.checkIn.findMany({
        where: { receiver: { userId } },
        select: {
          id: true,
          receiverId: true,
          scheduledAt: true,
          status: true,
          channelUsed: true,
          sentAt: true,
          respondedAt: true,
          responseDetectedAs: true,
          resolvedAt: true,
          resolutionByUserId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.checkInAttempt.findMany({
        where: { checkIn: { receiver: { userId } } },
        select: {
          id: true,
          checkInId: true,
          attemptNumber: true,
          channel: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          completedAt: true,
          providerStatus: true,
          failureReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.escalationEvent.findMany({
        where: { checkIn: { receiver: { userId } } },
        select: {
          id: true,
          checkInId: true,
          attemptNumber: true,
          channel: true,
          startedAt: true,
          completedAt: true,
          result: true,
          senderNotifiedAt: true,
          backupAlertedAt: true,
        },
      }),
      this.prisma.subscription.findMany({
        where: { userId },
        select: {
          id: true,
          tier: true,
          status: true,
          paymentProvider: true,
          trialEndsAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          canceledAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { actorId: userId },
            { entityType: 'user', entityId: userId },
            { entityType: 'receiver', entityId: { in: await this.receiverIdsForUser(userId) } },
          ],
        },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          action: true,
          actorType: true,
          actorId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      user,
      receivers: receivers.map((receiver) => ({
        ...receiver,
        pausedUntil: receiver.pausedUntil ?? undefined,
        pausedReason: receiver.pausedReason ?? undefined,
      })),
      backupContacts: backupContacts.map((contact) => ({
        ...contact,
        locationInstructionsEncrypted: contact.locationInstructionsEncrypted ?? undefined,
      })),
      checkIns,
      attempts,
      escalations,
      subscriptions,
      auditLogs,
    };
  }

  async deleteAccountData(input: {
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
  }): Promise<AccountDeletionResult | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) return null;

    return this.prisma.$transaction(async (tx) => {
      const receiverIds = await tx.receiver.findMany({
        where: { userId: input.userId, deletedAt: null },
        select: { id: true },
      });
      const backupContactCount = await tx.backupContact.count({
        where: { receiverId: { in: receiverIds.map((receiver) => receiver.id) }, deletedAt: null },
      });

      await tx.backupContact.updateMany({
        where: { receiverId: { in: receiverIds.map((receiver) => receiver.id) } },
        data: {
          nameEncrypted: input.anonymizedBackupNameEncrypted,
          phoneEncrypted: input.anonymizedBackupPhoneEncrypted,
          phoneHash: input.anonymizedBackupPhoneHash,
          locationInstructionsEncrypted: null,
          deletedAt: input.deletedAt,
        },
      });

      await tx.receiver.updateMany({
        where: { userId: input.userId },
        data: {
          nameEncrypted: input.anonymizedReceiverNameEncrypted,
          phoneEncrypted: input.anonymizedReceiverPhoneEncrypted,
          phoneHash: input.anonymizedReceiverPhoneHash,
          personalNoteEncrypted: null,
          deletedAt: input.deletedAt,
        },
      });

      await tx.user.update({
        where: { id: input.userId },
        data: {
          emailEncrypted: input.anonymizedUserEmailEncrypted,
          phoneEncrypted: input.anonymizedUserPhoneEncrypted,
          emailHash: input.anonymizedUserEmailHash,
          phoneHash: input.anonymizedUserPhoneHash,
          // The display name (CB-010) is personal data too and leaves with the rest of the identity.
          displayNameEncrypted: null,
          deletedAt: input.deletedAt,
        },
      });

      return {
        deletedAt: input.deletedAt,
        receiverCount: receiverIds.length,
        backupContactCount,
      };
    });
  }

  private async receiverIdsForUser(userId: string): Promise<string[]> {
    const receivers = await this.prisma.receiver.findMany({ where: { userId }, select: { id: true } });
    return receivers.map((receiver) => receiver.id);
  }

  private toStepUpChallengeRecord(challenge: StepUpChallenge): StepUpChallengeRecord {
    return {
      id: challenge.id,
      userId: challenge.userId,
      action: challenge.action,
      codeHash: challenge.codeHash,
      tokenHash: challenge.tokenHash ?? undefined,
      expiresAt: challenge.expiresAt,
      verifiedAt: challenge.verifiedAt ?? undefined,
      tokenExpiresAt: challenge.tokenExpiresAt ?? undefined,
      consumedAt: challenge.consumedAt ?? undefined,
      attemptCount: challenge.attemptCount,
      createdAt: challenge.createdAt,
    };
  }
}
