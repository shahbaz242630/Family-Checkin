import { Inject, Injectable } from '@nestjs/common';
import { CheckInStatus } from '@prisma/client';
import type { BackupContact, Channel, EscalationEvent, EscalationResult } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ESCALATION_CHECK_IN_ALLOWED_FROM } from './escalations.repository';
import type {
  CreateEscalationEventInput,
  EscalationBackupContactRecord,
  EscalationEventRecord,
  EscalationReceiverOwnerRecord,
  EscalationsRepository,
} from './escalations.repository';

interface ReceiverOwnerRow {
  userId: string;
  nameEncrypted: string;
  language: string;
  user: { phoneEncrypted: string };
}

interface EscalationsPrismaClient {
  receiver: {
    findFirst(args: {
      where: { id: string; deletedAt: null };
      select: { userId: true; nameEncrypted: true; language: true; user: { select: { phoneEncrypted: true } } };
    }): Promise<ReceiverOwnerRow | null>;
  };
  backupContact: {
    findMany(args: {
      where: { receiverId: string; deletedAt: null };
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }];
    }): Promise<BackupContact[]>;
  };
  checkInAttempt: {
    findMany(args: {
      where: { checkInId: string; sentAt: { not: null } };
      orderBy: { attemptNumber: 'asc' };
      select: { channel: true };
    }): Promise<Array<{ channel: Channel }>>;
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
    updateMany(args: {
      where: { id: string; status: { in: CheckInStatus[] } };
      data: { status: CheckInStatus };
    }): Promise<{ count: number }>;
  };
}

@Injectable()
export class PrismaEscalationsRepository implements EscalationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: EscalationsPrismaClient | PrismaService) {}

  async findReceiverOwner(input: { receiverId: string }): Promise<EscalationReceiverOwnerRecord | null> {
    const receiver = (await this.prisma.receiver.findFirst({
      where: {
        id: input.receiverId,
        deletedAt: null,
      },
      select: {
        userId: true,
        nameEncrypted: true,
        language: true,
        user: {
          select: {
            phoneEncrypted: true,
          },
        },
      },
    })) as ReceiverOwnerRow | null;

    return receiver
      ? {
          userId: receiver.userId,
          phoneEncrypted: receiver.user.phoneEncrypted,
          receiverNameEncrypted: receiver.nameEncrypted,
          receiverLanguage: receiver.language,
        }
      : null;
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
      locationInstructionsEncrypted: contact.locationInstructionsEncrypted ?? undefined,
      priorityOrder: contact.priorityOrder,
      createdAt: contact.createdAt,
    }));
  }

  async findChannelsTriedForCheckIn(input: { checkInId: string }): Promise<Channel[]> {
    const attempts = (await this.prisma.checkInAttempt.findMany({
      where: {
        checkInId: input.checkInId,
        sentAt: { not: null },
      },
      orderBy: { attemptNumber: 'asc' },
      select: { channel: true },
    })) as Array<{ channel: Channel }>;

    return attempts.map((attempt) => attempt.channel);
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
    await this.prisma.checkIn.updateMany({
      where: { id: input.checkInId, status: { in: [...ESCALATION_CHECK_IN_ALLOWED_FROM.escalated] } },
      data: { status: CheckInStatus.ESCALATED },
    });
  }

  async markCheckInTerminal(input: { checkInId: string; status: CheckInStatus }): Promise<void> {
    await this.prisma.checkIn.updateMany({
      where: { id: input.checkInId, status: { in: [...ESCALATION_CHECK_IN_ALLOWED_FROM.terminal] } },
      data: { status: input.status },
    });
  }
}
