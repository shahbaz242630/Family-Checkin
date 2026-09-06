import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    const user = await this.prisma.user.upsert({
      where: { authProviderId: input.authProviderId },
      create: input,
      update: {
        emailEncrypted: input.emailEncrypted,
        emailHash: input.emailHash,
        phoneEncrypted: input.phoneEncrypted,
        phoneHash: input.phoneHash,
        country: input.country,
        preferredLanguage: input.preferredLanguage,
        timezone: input.timezone,
      },
    });

    return this.toSenderRecord(user);
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
      country: user.country,
      // Trimmed on read as well: a database that has not yet run 202609060102_language_columns_varchar still
      // holds a space-padded char(5) value, and the API must answer "en" either way (CB-075).
      preferredLanguage: user.preferredLanguage.trim(),
      timezone: user.timezone,
    };
  }
}
