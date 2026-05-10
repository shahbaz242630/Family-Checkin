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

export interface PushNotificationsRepository {
  upsertDeviceToken(input: RegisterPushDeviceTokenInput): Promise<PushDeviceTokenRecord>;
  findActiveDeviceTokensForUser(input: { userId: string }): Promise<PushDeviceTokenRecord[]>;
  markDeviceTokenInactive(input: { token: string; inactiveAt: Date }): Promise<void>;
}
