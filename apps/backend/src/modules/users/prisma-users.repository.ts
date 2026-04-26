import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

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
      preferredLanguage: user.preferredLanguage,
      timezone: user.timezone,
    };
  }
}
