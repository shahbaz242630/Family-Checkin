import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SenderUniqueConflictError } from './users.repository';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

/** Prisma's error code for a unique-constraint violation, checked structurally so a mock can raise it too. */
const UNIQUE_VIOLATION_CODE = 'P2002';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findSenderByAuthProviderId(authProviderId: string): Promise<SenderRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { authProviderId } });

    return user ? this.toSenderRecord(user) : null;
  }

  async createSender(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    const { displayNameEncrypted, ...identity } = input;
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { ...identity, displayNameEncrypted: displayNameEncrypted ?? null },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new SenderUniqueConflictError(input.authProviderId);
      }
      throw error;
    }

    return this.toSenderRecord(user);
  }

  async upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    const { displayNameEncrypted, ...identity } = input;
    let user: User;
    try {
      user = await this.prisma.user.upsert({
        where: { authProviderId: input.authProviderId },
        create: { ...identity, displayNameEncrypted: displayNameEncrypted ?? null },
        update: {
          emailEncrypted: input.emailEncrypted,
          emailHash: input.emailHash,
          phoneEncrypted: input.phoneEncrypted,
          phoneHash: input.phoneHash,
          country: input.country,
          preferredLanguage: input.preferredLanguage,
          timezone: input.timezone,
          // Only written when the identity carried a name; a sync without one keeps what is stored (CB-010).
          ...(displayNameEncrypted !== undefined ? { displayNameEncrypted } : {}),
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new SenderUniqueConflictError(input.authProviderId);
      }
      throw error;
    }

    return this.toSenderRecord(user);
  }

  async findDisplayNameEncryptedById(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { displayNameEncrypted: true },
    });

    return user?.displayNameEncrypted ?? null;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
    );
  }

  private toSenderRecord(user: User): SenderRecord {
    if (!user.authProviderId) {
      throw new Error('Sender record is missing auth provider id');
    }

    return {
      id: user.id,
      authProviderId: user.authProviderId,
      emailEncrypted: user.emailEncrypted,
      emailHash: user.emailHash,
      phoneEncrypted: user.phoneEncrypted,
      phoneHash: user.phoneHash,
      displayNameEncrypted: user.displayNameEncrypted ?? undefined,
      country: user.country,
      // Trimmed on read as well: a database that has not yet run 202609060102_language_columns_varchar still
      // holds a space-padded char(5) value, and the API must answer "en" either way (CB-075).
      preferredLanguage: user.preferredLanguage.trim(),
      timezone: user.timezone,
    };
  }
}
