import { Inject, Injectable } from '@nestjs/common';
import { CheckInStatus } from '@prisma/client';
import type { BackupContact, Channel, EscalationEvent, EscalationResult } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CreateEscalationEventInput,
  EscalationBackupContactRecord,
  EscalationEventRecord,
  EscalationsRepository,
} from './escalations.repository';

interface EscalationsPrismaClient {
  receiver: {
    findFirst(args: {
      where: { id: string; deletedAt: null };
      select: { userId: true; user: { select: { phoneEncrypted: true } } };
    }): Promise<{ userId: string; user: { phoneEncrypted: string } } | null>;
  };
  backupContact: {
    findMany(args: {
      where: { receiverId: string; deletedAt: null };
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }];
    }): Promise<BackupContact[]>;
  };
  escalationEvent: {
    create(args: {
      data: {
        checkInId: string;
        attemptNumber: number;
        channel: Channel;
        startedAt: Date;
        completedAt?: Date;
        result?: EscalationResult;
        errorDetails?: string;
        senderNotifiedAt?: Date;
        backupAlertedAt?: Date;
      };
    }): Promise<EscalationEvent>;
  };
  checkIn: {
    update(args: { where: { id: string }; data: { status: CheckInStatus } }): Promise<unknown>;
  };
}

@Injectable()
export class PrismaEscalationsRepository implements EscalationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: EscalationsPrismaClient | PrismaService) {}

  async findReceiverOwner(input: { receiverId: string }): Promise<{ userId: string; phoneEncrypted: string } | null> {
    const receiver = (await this.prisma.receiver.findFirst({
      where: {
        id: input.receiverId,
        deletedAt: null,
      },
      select: {
        userId: true,
        user: {
          select: {
            phoneEncrypted: true,
          },
        },
      },
    })) as { userId: string; user: { phoneEncrypted: string } } | null;

    return receiver ? { userId: receiver.userId, phoneEncrypted: receiver.user.phoneEncrypted } : null;
  }

  async findActiveBackupContactsForReceiver(input: { receiverId: string }): Promise<EscalationBackupContactRecord[]> {
    const contacts = await this.prisma.backupContact.findMany({
      where: {
        receiverId: input.receiverId,
        deletedAt: null,
      },
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return contacts.map((contact) => ({
      id: contact.id,
      receiverId: contact.receiverId,
      nameEncrypted: contact.nameEncrypted,
      phoneEncrypted: contact.phoneEncrypted,
      priorityOrder: contact.priorityOrder,
      createdAt: contact.createdAt,
    }));
  }

  async createEvent(input: CreateEscalationEventInput): Promise<EscalationEventRecord> {
    const event = await this.prisma.escalationEvent.create({
      data: {
        checkInId: input.checkInId,
        attemptNumber: input.attemptNumber,
        channel: input.channel,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        result: input.result,
        errorDetails: input.errorDetails,
        senderNotifiedAt: input.senderNotifiedAt,
        backupAlertedAt: input.backupAlertedAt,
      },
    });

    return {
      id: event.id,
      checkInId: event.checkInId,
      attemptNumber: event.attemptNumber,
      channel: event.channel,
      startedAt: event.startedAt,
      completedAt: event.completedAt ?? undefined,
      result: event.result ?? undefined,
      errorDetails: event.errorDetails ?? undefined,
      senderNotifiedAt: event.senderNotifiedAt ?? undefined,
      backupAlertedAt: event.backupAlertedAt ?? undefined,
    };
  }

  async markCheckInEscalated(input: { checkInId: string }): Promise<void> {
    await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: { status: CheckInStatus.ESCALATED },
    });
  }

  async markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void> {
    await this.prisma.checkIn.update({
      where: { id: input.checkInId },
      data: { status: input.status },
    });
  }
}
