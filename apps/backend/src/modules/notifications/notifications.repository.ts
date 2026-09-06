export type PushPlatform = 'ios' | 'android' | 'web';

export interface PushDeviceTokenRecord {
  id: string;
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceId?: string;
  active: boolean;
  lastRegisteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterPushDeviceTokenInput {
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceId?: string;
  registeredAt: Date;
}

/** An accepted Expo ticket waiting for its receipt; `token` is the device token it was issued for (CB-023). */
export interface PushTicketRecord {
  ticketId: string;
  token: string;
  createdAt: Date;
}

export interface PushNotificationsRepository {
  upsertDeviceToken(input: RegisterPushDeviceTokenInput): Promise<PushDeviceTokenRecord>;
  findActiveDeviceTokensForUser(input: { userId: string }): Promise<PushDeviceTokenRecord[]>;
  markDeviceTokenInactive(input: { token: string; inactiveAt: Date }): Promise<void>;
  /** Stores accepted tickets; a ticket id seen before is ignored. */
  recordPushTickets(input: { tickets: Array<{ ticketId: string; token: string }>; createdAt: Date }): Promise<void>;
  /** Oldest first, created strictly before `before`, at most `limit`. */
  findPushTicketsCreatedBefore(input: { before: Date; limit: number }): Promise<PushTicketRecord[]>;
  deletePushTickets(input: { ticketIds: string[] }): Promise<void>;
}
