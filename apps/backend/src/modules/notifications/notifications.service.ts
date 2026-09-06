import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket, PushGateway } from './expo-push.gateway';
import { EXPO_DEVICE_NOT_REGISTERED, ExpoPushGateway } from './expo-push.gateway';
import type { PushNotificationsRepository, PushPlatform } from './notifications.repository';
import { PUSH_NOTIFICATIONS_REPOSITORY } from './notifications.tokens';

/** What the service needs from a push gateway; receipts are optional so a bare send function still works in specs. */
export interface PushGatewayClient {
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  getReceipts?(ticketIds: string[]): Promise<ExpoPushReceipt[]>;
}

/** Expo asks that receipts be fetched no earlier than 15 minutes after the send. */
export const PUSH_RECEIPT_DELAY_MS = 15 * 60 * 1000;
/** Expo keeps receipts for about 24 hours; a ticket still without one after that is dropped. */
export const PUSH_TICKET_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Tickets looked at per pass; the next send batch picks up the rest. */
export const PUSH_RECEIPT_BATCH_LIMIT = 300;
export const INVALID_PUSH_TOKEN_MESSAGE = 'A valid Expo push token is required';

export interface ProcessPushReceiptsResult {
  /** Tickets old enough to have a receipt that were looked at. */
  checked: number;
  /** Receipts Expo had for them. */
  received: number;
  /** Device tokens deactivated because the receipt said DeviceNotRegistered. */
  deactivated: number;
  /** Tickets dropped because Expo had no receipt within 24 hours. */
  expired: number;
}

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

const ESCALATION_SIREN_SOUND = 'escalation-siren.wav';
const DEFAULT_DEEP_LINK = '/(main)';
export const QUIET_UPDATE_NOTIFICATION_TYPE = 'quiet_update';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PUSH_NOTIFICATIONS_REPOSITORY)
    private readonly notificationsRepository: PushNotificationsRepository,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(ExpoPushGateway)
    private readonly pushGatewayOrSend: PushGatewayClient | PushGateway,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async registerDeviceToken(input: RegisterDeviceTokenInput): Promise<RegisteredDeviceTokenResponse> {
    const userId = input.userId.trim();
    const token = input.token.trim();
    if (!this.isExpoPushToken(token)) {
      throw new Error(INVALID_PUSH_TOKEN_MESSAGE);
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
        deepLink: input.data.deepLink ?? DEFAULT_DEEP_LINK,
      },
      sound: ESCALATION_SIREN_SOUND,
      priority: 'high',
      channelId: 'emergency-alerts',
      interruptionLevel: 'timeSensitive',
    }));
  }

  /**
   * A routine update for the sender (consent answered, STOP, backup contact DONE): default sound, default
   * channel and no time-sensitive interruption, so it never masquerades as the escalation siren (CB-012).
   */
  async sendQuietUpdateToUser(input: SendUserPushInput): Promise<SendUserPushResult> {
    return this.sendToUserWithMessage(input, (token) => ({
      to: token.token,
      title: input.title,
      body: input.body,
      data: {
        ...input.data,
        notificationType: QUIET_UPDATE_NOTIFICATION_TYPE,
        deepLink: input.data.deepLink ?? DEFAULT_DEEP_LINK,
      },
      sound: 'default',
    }));
  }

  /**
   * Reads the receipts of tickets older than 15 minutes, deactivates tokens whose device is gone
   * (`DeviceNotRegistered`), deletes every ticket that got a receipt and drops tickets past 24 hours (CB-023).
   * Runs at the start of each send batch; a cron route can call it too once one exists.
   */
  async processDuePushReceipts(): Promise<ProcessPushReceiptsResult> {
    const result: ProcessPushReceiptsResult = { checked: 0, received: 0, deactivated: 0, expired: 0 };
    const gateway = this.pushGatewayOrSend;
    if (typeof gateway === 'function' || !gateway.getReceipts) {
      return result;
    }

    const now = this.now();
    const due = await this.notificationsRepository.findPushTicketsCreatedBefore({
      before: new Date(now.getTime() - PUSH_RECEIPT_DELAY_MS),
      limit: PUSH_RECEIPT_BATCH_LIMIT,
    });
    if (due.length === 0) {
      return result;
    }

    result.checked = due.length;
    const receipts = new Map(
      (await gateway.getReceipts(due.map((ticket) => ticket.ticketId))).map((receipt) => [receipt.id, receipt]),
    );
    const processed: string[] = [];

    for (const ticket of due) {
      const receipt = receipts.get(ticket.ticketId);
      if (receipt) {
        result.received += 1;
        if (!receipt.ok && receipt.error === EXPO_DEVICE_NOT_REGISTERED) {
          await this.notificationsRepository.markDeviceTokenInactive({ token: ticket.token, inactiveAt: now });
          result.deactivated += 1;
        }
        processed.push(ticket.ticketId);
      } else if (ticket.createdAt.getTime() <= now.getTime() - PUSH_TICKET_MAX_AGE_MS) {
        result.expired += 1;
        processed.push(ticket.ticketId);
      }
    }

    await this.notificationsRepository.deletePushTickets({ ticketIds: processed });

    return result;
  }

  private async sendToUserWithMessage(
    input: SendUserPushInput,
    buildMessage: (token: { token: string }) => ExpoPushMessage,
  ): Promise<SendUserPushResult> {
    // Opportunistic housekeeping before every batch, so a token whose receipt said DeviceNotRegistered is not
    // tried again here. It must never stand in the way of a siren, so a failure is logged and ignored.
    await this.processDuePushReceiptsQuietly();

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
    const accepted: Array<{ ticketId: string; token: string }> = [];

    for (const [index, ticket] of tickets.entries()) {
      const token = tokens[index]?.token ?? '';
      if (ticket.ok) {
        sent += 1;
        if (ticket.id && token) {
          accepted.push({ ticketId: ticket.id, token });
        }
        continue;
      }

      failed += 1;
      if (ticket.error === EXPO_DEVICE_NOT_REGISTERED) {
        await this.notificationsRepository.markDeviceTokenInactive({
          token,
          inactiveAt: sentAt,
        });
      }
    }

    // The pushes are out; failing to file their tickets must not turn a delivered siren into a voice fallback.
    try {
      await this.notificationsRepository.recordPushTickets({ tickets: accepted, createdAt: sentAt });
    } catch (error) {
      this.logger.warn(`Could not record ${accepted.length} push ticket(s): ${errorSummary(error)}`);
    }

    return {
      attempted: tokens.length,
      sent,
      failed: failed + Math.max(0, tokens.length - tickets.length),
      sentAt: sent > 0 ? sentAt : undefined,
    };
  }

  private async processDuePushReceiptsQuietly(): Promise<void> {
    try {
      await this.processDuePushReceipts();
    } catch (error) {
      this.logger.warn(`Push receipt check skipped: ${errorSummary(error)}`);
    }
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

/** Bounded error text for logs; never a token or a payload. */
function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : 'unknown error').slice(0, 200);
}
