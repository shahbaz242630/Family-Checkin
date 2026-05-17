import { Inject, Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { ExpoPushMessage, ExpoPushTicket, PushGateway } from './expo-push.gateway';
import { ExpoPushGateway } from './expo-push.gateway';
import type { PushNotificationsRepository, PushPlatform } from './notifications.repository';
import { PUSH_NOTIFICATIONS_REPOSITORY } from './notifications.tokens';

export interface RegisterDeviceTokenInput {
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RegisteredDeviceTokenResponse {
  id: string;
  platform: PushPlatform;
  active: boolean;
  registeredAt: string;
}

export interface SendUserPushInput {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface SendUserPushResult {
  attempted: number;
  sent: number;
  failed: number;
  sentAt?: Date;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PUSH_NOTIFICATIONS_REPOSITORY)
    private readonly notificationsRepository: PushNotificationsRepository,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(ExpoPushGateway)
    private readonly pushGatewayOrSend: ExpoPushGateway | PushGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async registerDeviceToken(input: RegisterDeviceTokenInput): Promise<RegisteredDeviceTokenResponse> {
    const userId = input.userId.trim();
    const token = input.token.trim();
    if (!this.isExpoPushToken(token)) {
      throw new Error('A valid Expo push token is required');
    }

    const registeredAt = this.now();
    const record = await this.notificationsRepository.upsertDeviceToken({
      userId,
      token,
      platform: input.platform,
      deviceId: input.deviceId?.trim() || undefined,
      registeredAt,
    });

    await this.auditService.append({
      entityType: 'user',
      entityId: userId,
      action: 'push.device_token_registered',
      actorType: ActorType.USER,
      actorId: userId,
      metadata: {
        platform: record.platform,
        deviceIdPresent: Boolean(record.deviceId),
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      id: record.id,
      platform: record.platform,
      active: record.active,
      registeredAt: record.lastRegisteredAt.toISOString(),
    };
  }

  async sendToUser(input: SendUserPushInput): Promise<SendUserPushResult> {
    return this.sendToUserWithMessage(input, (token) => ({
      to: token.token,
      title: input.title,
      body: input.body,
      data: input.data,
    }));
  }

  async sendEscalationAlertToUser(input: SendUserPushInput): Promise<SendUserPushResult> {
    return this.sendToUserWithMessage(input, (token) => ({
      to: token.token,
      title: input.title,
      body: input.body,
      data: {
        ...input.data,
        notificationType: 'escalation_siren',
        deepLink: input.data.deepLink ?? '/(main)',
      },
      sound: 'default',
      priority: 'high',
      channelId: 'emergency-alerts',
      interruptionLevel: 'timeSensitive',
    }));
  }

  private async sendToUserWithMessage(
    input: SendUserPushInput,
    buildMessage: (token: { token: string }) => ExpoPushMessage,
  ): Promise<SendUserPushResult> {
    const tokens = await this.notificationsRepository.findActiveDeviceTokensForUser({ userId: input.userId.trim() });
    const sentAt = this.now();
    if (tokens.length === 0) {
      return {
        attempted: 0,
        sent: 0,
        failed: 0,
      };
    }

    const messages = tokens.map(buildMessage);
    const tickets = await this.sendPush(messages);
    let sent = 0;
    let failed = 0;

    for (const [index, ticket] of tickets.entries()) {
      if (ticket.ok) {
        sent += 1;
        continue;
      }

      failed += 1;
      if (ticket.error === 'DeviceNotRegistered') {
        await this.notificationsRepository.markDeviceTokenInactive({
          token: tokens[index]?.token ?? '',
          inactiveAt: sentAt,
        });
      }
    }

    return {
      attempted: tokens.length,
      sent,
      failed: failed + Math.max(0, tokens.length - tickets.length),
      sentAt: sent > 0 ? sentAt : undefined,
    };
  }

  private async sendPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    return typeof this.pushGatewayOrSend === 'function'
      ? await this.pushGatewayOrSend(messages)
      : await this.pushGatewayOrSend.send(messages);
  }

  private isExpoPushToken(token: string): boolean {
    return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
  }
}
