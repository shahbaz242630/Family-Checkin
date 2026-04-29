import { Inject, Injectable } from '@nestjs/common';
import type { BackupContact } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  BackupContactRecord,
  BackupContactsRepository,
  CreateBackupContactRecordInput,
  DeleteBackupContactRecordInput,
  UpdateBackupContactRecordInput,
} from './backup-contacts.repository';

interface BackupContactsPrismaClient {
  receiver: {
    findFirst(args: {
      where: { id: string; userId: string; deletedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  backupContact: {
    findMany(args: {
      where: { receiverId: string; deletedAt: null };
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }];
    }): Promise<BackupContact[]>;
    count(args: { where: { receiverId: string; deletedAt: null } }): Promise<number>;
    create(args: {
      data: {
        receiverId: string;
        nameEncrypted: string;
        phoneEncrypted: string;
        phoneHash: string;
        relationshipToReceiver: string;
        locationInstructionsEncrypted?: string;
        priorityOrder: number;
      };
    }): Promise<BackupContact>;
    findFirst(args: {
      where: { id: string; receiverId: string; deletedAt?: null };
    }): Promise<BackupContact | null>;
    updateMany(args: {
      where: { id: string; receiverId: string; deletedAt: null };
      data: {
        nameEncrypted?: string;
        phoneEncrypted?: string;
        phoneHash?: string;
        relationshipToReceiver?: string;
        locationInstructionsEncrypted?: string | null;
        deletedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
}

@Injectable()
export class PrismaBackupContactsRepository implements BackupContactsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: BackupContactsPrismaClient | PrismaService) {}

  async findManyForReceiverForUser(input: { userId: string; receiverId: string }): Promise<BackupContactRecord[] | null> {
    const ownsReceiver = await this.receiverExistsForUser(input);
    if (!ownsReceiver) {
      return null;
    }

    const contacts = await this.prisma.backupContact.findMany({
      where: {
        receiverId: input.receiverId,
        deletedAt: null,
      },
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return contacts.map((contact) => this.toRecord(contact));
  }

  async countActiveForReceiverForUser(input: { userId: string; receiverId: string }): Promise<number | null> {
    const ownsReceiver = await this.receiverExistsForUser(input);
    if (!ownsReceiver) {
      return null;
    }

    return await this.prisma.backupContact.count({
      where: {
        receiverId: input.receiverId,
        deletedAt: null,
      },
    });
  }

  async createForReceiverForUser(input: CreateBackupContactRecordInput): Promise<BackupContactRecord | null> {
    const ownsReceiver = await this.receiverExistsForUser(input);
    if (!ownsReceiver) {
      return null;
    }

    const contact = await this.prisma.backupContact.create({
      data: {
        receiverId: input.receiverId,
        nameEncrypted: input.nameEncrypted,
        phoneEncrypted: input.phoneEncrypted,
        phoneHash: input.phoneHash,
        relationshipToReceiver: input.relationshipToReceiver,
        locationInstructionsEncrypted: input.locationInstructionsEncrypted,
        priorityOrder: input.priorityOrder,
      },
    });

    return this.toRecord(contact);
  }

  async updateForReceiverForUser(input: UpdateBackupContactRecordInput): Promise<BackupContactRecord | null> {
    const ownsReceiver = await this.receiverExistsForUser(input);
    if (!ownsReceiver) {
      return null;
    }

    const data: {
      nameEncrypted: string;
      phoneEncrypted?: string;
      phoneHash?: string;
      relationshipToReceiver: string;
      locationInstructionsEncrypted?: string | null;
    } = {
      nameEncrypted: input.nameEncrypted,
      relationshipToReceiver: input.relationshipToReceiver,
      locationInstructionsEncrypted: input.locationInstructionsEncrypted,
    };

    if (input.phoneEncrypted) {
      data.phoneEncrypted = input.phoneEncrypted;
    }
    if (input.phoneHash) {
      data.phoneHash = input.phoneHash;
    }

    const result = await this.prisma.backupContact.updateMany({
      where: {
        id: input.backupContactId,
        receiverId: input.receiverId,
        deletedAt: null,
      },
      data,
    });

    if (result.count === 0) {
      return null;
    }

    const contact = await this.prisma.backupContact.findFirst({
      where: {
        id: input.backupContactId,
        receiverId: input.receiverId,
      },
    });

    return contact ? this.toRecord(contact) : null;
  }

  async deleteForReceiverForUser(input: DeleteBackupContactRecordInput): Promise<BackupContactRecord | null> {
    const ownsReceiver = await this.receiverExistsForUser(input);
    if (!ownsReceiver) {
      return null;
    }

    const contact = await this.prisma.backupContact.findFirst({
      where: {
        id: input.backupContactId,
        receiverId: input.receiverId,
        deletedAt: null,
      },
    });

    if (!contact) {
      return null;
    }

    const result = await this.prisma.backupContact.updateMany({
      where: {
        id: input.backupContactId,
        receiverId: input.receiverId,
        deletedAt: null,
      },
      data: {
        deletedAt: input.deletedAt,
      },
    });

    return result.count > 0 ? this.toRecord({ ...contact, deletedAt: input.deletedAt }) : null;
  }

  private async receiverExistsForUser(input: { userId: string; receiverId: string }): Promise<boolean> {
    const receiver = await this.prisma.receiver.findFirst({
      where: {
        id: input.receiverId,
        userId: input.userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    return Boolean(receiver);
  }

  private toRecord(contact: BackupContact): BackupContactRecord {
    return {
      id: contact.id,
      receiverId: contact.receiverId,
      nameEncrypted: contact.nameEncrypted,
      phoneEncrypted: contact.phoneEncrypted,
      phoneHash: contact.phoneHash,
      relationshipToReceiver: contact.relationshipToReceiver,
      locationInstructionsEncrypted: contact.locationInstructionsEncrypted ?? undefined,
      priorityOrder: contact.priorityOrder,
      deletedAt: contact.deletedAt ?? undefined,
      createdAt: contact.createdAt,
    };
  }
}
