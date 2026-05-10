import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  PushDeviceTokenRecord,
  PushNotificationsRepository,
  RegisterPushDeviceTokenInput,
} from './notifications.repository';

interface DeviceTokenRow {
  id: string;
  userId: string;
  token: string;
  platform: string;
  deviceId: string | null;
  active: boolean;
  lastRegisteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationsPrismaClient {
  deviceToken: {
    upsert(args: {
      where: { token: string };
      create: {
        userId: string;
        token: string;
        platform: string;
        deviceId?: string;
        active: boolean;
        lastRegisteredAt: Date;
      };
      update: {
        userId: string;
        platform: string;
        deviceId?: string | null;
        active: boolean;
        lastRegisteredAt: Date;
      };
    }): Promise<DeviceTokenRow>;
    findMany(args: {
      where: { userId: string; active: true };
      orderBy: { lastRegisteredAt: 'desc' };
    }): Promise<DeviceTokenRow[]>;
    updateMany(args: {
      where: { token: string };
      data: { active: false; updatedAt: Date };
    }): Promise<unknown>;
  };
}

@Injectable()
export class PrismaNotificationsRepository implements PushNotificationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: NotificationsPrismaClient) {}

  async upsertDeviceToken(input: RegisterPushDeviceTokenInput): Promise<PushDeviceTokenRecord> {
    const row = await this.prisma.deviceToken.upsert({
      where: {
        token: input.token,
      },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId,
        active: true,
        lastRegisteredAt: input.registeredAt,
      },
      update: {
        userId: input.userId,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        active: true,
        lastRegisteredAt: input.registeredAt,
      },
    });

    return toRecord(row);
  }

  async findActiveDeviceTokensForUser(input: { userId: string }): Promise<PushDeviceTokenRecord[]> {
    const rows = await this.prisma.deviceToken.findMany({
      where: {
        userId: input.userId,
        active: true,
      },
      orderBy: {
        lastRegisteredAt: 'desc',
      },
    });

    return rows.map(toRecord);
  }

  async markDeviceTokenInactive(input: { token: string; inactiveAt: Date }): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: {
        token: input.token,
      },
      data: {
        active: false,
        updatedAt: input.inactiveAt,
      },
    });
  }
}

function toRecord(row: DeviceTokenRow): PushDeviceTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    token: row.token,
    platform: row.platform as PushDeviceTokenRecord['platform'],
    deviceId: row.deviceId ?? undefined,
    active: row.active,
    lastRegisteredAt: row.lastRegisteredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
