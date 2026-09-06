import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    const { displayNameEncrypted, ...identity } = input;
    const user = await this.prisma.user.upsert({
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

    return this.toSenderRecord(user);
  }

  async findDisplayNameEncryptedById(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { displayNameEncrypted: true },
    });

    return user?.displayNameEncrypted ?? null;
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
