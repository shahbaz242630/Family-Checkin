import { Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ReceiversController } from './receivers.controller';

class FakeSupabaseAuthService {
  async verifyAccessToken(accessToken: string) {
    return {
      id: `auth-${accessToken}`,
      email: 'sender@example.com',
      phone: '+971500000000',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    };
  }
}

class FakeUsersService {
  async upsertFromSupabaseIdentity() {
    return {
      id: '61a5639c-c902-4950-9924-1a4d6db1e02d',
    };
  }
}

class FakeReceiversService {
  public listedForUserId: string | null = null;
  public detailInput: { userId: string; receiverId: string } | null = null;
  public updateInput: Record<string, unknown> | null = null;
  public resolveInput: Record<string, unknown> | null = null;
  public alertBackupInput: Record<string, unknown> | null = null;
  public tryLaterInput: Record<string, unknown> | null = null;

  async listForSender(userId: string) {
    this.listedForUserId = userId;
    return [
      {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        displayName: 'Fatima Parent',
        phoneMasked: '*******4567',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
        consentStatus: ConsentStatus.GRANTED,
        createdAt: '2026-04-26T08:00:00.000Z',
        updatedAt: '2026-04-27T10:02:00.000Z',
      },
    ];
  }

  async getForSender(input: { userId: string; receiverId: string }) {
    this.detailInput = input;
    return {
      id: input.receiverId,
      displayName: 'Fatima Parent',
      phoneMasked: '*******4567',
      countryCode: 'AE',
      relationshipType: RelationshipType.PARENT,
      language: 'en',
      timezone: 'Asia/Dubai',
      techProfile: TechProfile.WHATSAPP,
      primaryChannel: Channel.WHATSAPP,
      fallbackChannels: [Channel.SMS],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
      consentStatus: ConsentStatus.GRANTED,
      backupContacts: [],
      escalation: {
        configured: false,
        nextStep: 'Add backup contacts',
      },
      createdAt: '2026-04-26T08:00:00.000Z',
      updatedAt: '2026-04-27T10:02:00.000Z',
    };
  }

  async pauseForSender(input: { userId: string; receiverId: string; ipAddress?: string; userAgent?: string }) {
    this.detailInput = input;
    return {
      id: input.receiverId,
      pausedUntil: '9999-12-31T23:59:59.999Z',
      pausedReason: 'USER_PAUSED',
    };
  }

  async resumeForSender(input: { userId: string; receiverId: string; ipAddress?: string; userAgent?: string }) {
    this.detailInput = input;
    return {
      id: input.receiverId,
      pausedUntil: undefined,
      pausedReason: undefined,
    };
  }

  async updateForSender(input: Record<string, unknown>) {
    this.updateInput = input;
    return {
      id: input.receiverId,
      displayName: input.name,
      countryCode: input.countryCode,
      relationshipType: input.relationshipType,
      language: input.language,
      timezone: input.timezone,
      techProfile: input.techProfile,
      primaryChannel: input.primaryChannel,
      fallbackChannels: input.fallbackChannels,
      scheduleFrequency: input.scheduleFrequency,
      scheduleTimeWindow: input.scheduleTimeWindow,
    };
  }

  async deleteForSender(input: { userId: string; receiverId: string; ipAddress?: string; userAgent?: string }) {
    this.detailInput = input;
    return {
      id: input.receiverId,
      deleted: true,
    };
  }

  async resolveCheckInForSender(input: Record<string, unknown>) {
    this.resolveInput = input;
    return {
      id: input.receiverId,
      latestCheckIn: {
        id: input.checkInId,
        status: 'RESOLVED',
        resolvedAt: '2026-04-30T10:00:00.000Z',
        resolutionByUserId: input.userId,
      },
    };
  }

  async alertBackupForSender(input: Record<string, unknown>) {
    this.alertBackupInput = input;
    return {
      id: input.receiverId,
      latestCheckIn: {
        id: input.checkInId,
        status: 'ESCALATED',
      },
    };
  }

  async tryCheckInLaterForSender(input: Record<string, unknown>) {
    this.tryLaterInput = input;
    return {
      id: input.receiverId,
      latestCheckIn: {
        id: input.checkInId,
        status: 'SKIPPED',
      },
    };
  }
}

class FakeReceiverConsentService {}

describe('ReceiversController', () => {
  it('lists receivers for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.list('Bearer access-token');

    expect(receiversService.listedForUserId).toBe('61a5639c-c902-4950-9924-1a4d6db1e02d');
    expect(response).toEqual({
      receivers: [
        {
          id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
          displayName: 'Fatima Parent',
          phoneMasked: '*******4567',
          countryCode: 'AE',
          relationshipType: RelationshipType.PARENT,
          language: 'en',
          timezone: 'Asia/Dubai',
          techProfile: TechProfile.WHATSAPP,
          primaryChannel: Channel.WHATSAPP,
          fallbackChannels: [Channel.SMS],
          scheduleFrequency: 'daily',
          scheduleTimeWindow: { start: '09:00', end: '11:00' },
          consentStatus: ConsentStatus.GRANTED,
          createdAt: '2026-04-26T08:00:00.000Z',
          updatedAt: '2026-04-27T10:02:00.000Z',
        },
      ],
    });
  });

  it('returns receiver detail for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.detail('Bearer access-token', '1aef91f9-64c9-4548-baa5-d70b52386efb');

    expect(receiversService.detailInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Parent',
      backupContacts: [],
      escalation: {
        configured: false,
        nextStep: 'Add backup contacts',
      },
    });
  });

  it('pauses a receiver for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.pause(
      'Bearer access-token',
      '203.0.113.10',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
    );

    expect(receiversService.detailInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: '9999-12-31T23:59:59.999Z',
      pausedReason: 'USER_PAUSED',
    });
  });

  it('resumes a receiver for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.resume(
      'Bearer access-token',
      '203.0.113.10',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
    );

    expect(receiversService.detailInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: undefined,
      pausedReason: undefined,
    });
  });

  it('updates a receiver for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.update(
      'Bearer access-token',
      '203.0.113.10',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      {
        name: 'Fatima Updated',
        countryCode: 'GB',
        relationshipType: RelationshipType.GRANDPARENT,
        language: 'en-GB',
        timezone: 'Europe/London',
        techProfile: TechProfile.SMS,
        primaryChannel: Channel.SMS,
        fallbackChannels: [Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '08:00', end: '10:00' },
      },
    );

    expect(receiversService.updateInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      name: 'Fatima Updated',
      countryCode: 'GB',
      relationshipType: RelationshipType.GRANDPARENT,
      language: 'en-GB',
      timezone: 'Europe/London',
      techProfile: TechProfile.SMS,
      primaryChannel: Channel.SMS,
      fallbackChannels: [Channel.VOICE],
      scheduleFrequency: 'daily',
      scheduleTimeWindow: { start: '08:00', end: '10:00' },
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Updated',
    });
  });

  it('soft deletes a receiver for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.delete(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
    );

    expect(receiversService.detailInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response).toEqual({ receiver: { id: '1aef91f9-64c9-4548-baa5-d70b52386efb', deleted: true } });
  });

  it('resolves a receiver check-in for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.resolveCheckIn(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      'check-in-1',
    );

    expect(receiversService.resolveInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      latestCheckIn: {
        id: 'check-in-1',
        status: 'RESOLVED',
      },
    });
  });

  it('alerts backup contacts for a receiver check-in for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.alertBackupForCheckIn(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      'check-in-1',
    );

    expect(receiversService.alertBackupInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      latestCheckIn: {
        id: 'check-in-1',
        status: 'ESCALATED',
      },
    });
  });

  it('records try-later for a receiver check-in for the authenticated sender', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const response = await controller.tryCheckInLater(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      'check-in-1',
    );

    expect(receiversService.tryLaterInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      checkInId: 'check-in-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      latestCheckIn: {
        id: 'check-in-1',
        status: 'SKIPPED',
      },
    });
  });
});
