import { Channel, ConsentStatus, RelationshipType, SensitiveAction, TechProfile } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
  public createInput: Record<string, unknown> | null = null;
  public updateInput: Record<string, unknown> | null = null;
  public resolveInput: Record<string, unknown> | null = null;
  public alertBackupInput: Record<string, unknown> | null = null;
  public tryLaterInput: Record<string, unknown> | null = null;
  public nextCreateError: Error | null = null;

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

  async pauseForSender(input: { userId: string; receiverId: string; pausedUntil?: Date; ipAddress?: string; userAgent?: string }) {
    this.detailInput = input;
    return {
      id: input.receiverId,
      pausedUntil: input.pausedUntil?.toISOString() ?? '9999-12-31T23:59:59.999Z',
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

  async createForSender(input: Record<string, unknown>) {
    if (this.nextCreateError) {
      throw this.nextCreateError;
    }

    this.createInput = input;
    return {
      id: 'created-receiver-1',
      consentStatus: ConsentStatus.PENDING,
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

class FakeReceiverConsentService {
  public requestInput: Record<string, unknown> | null = null;

  async requestConsent(input: Record<string, unknown>) {
    this.requestInput = input;
  }
}

class FakeBillingService {
  constructor(private readonly entitled: boolean) {}

  async getBillingStatus() {
    return { entitled: this.entitled, subscription: null };
  }
}

class FakeBackupContactsService {
  public listInput: { userId: string; receiverId: string } | null = null;

  async listForReceiver(input: { userId: string; receiverId: string }) {
    this.listInput = input;
    return [
      {
        id: 'backup-contact-1',
        displayName: 'Backup Cousin',
        phoneMasked: '*******2222',
        relationshipToReceiver: 'Cousin',
        priorityOrder: 0,
        hasLocationInstructions: true,
        createdAt: '2026-04-29T08:00:00.000Z',
      },
    ];
  }
}

class FakeStepUpService {
  public consumedInput: Record<string, unknown> | null = null;

  async consumeStepUpToken(input: Record<string, unknown>) {
    this.consumedInput = input;
  }
}

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
    const backupContactsService = new FakeBackupContactsService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
      backupContactsService as never,
    );

    const response = await controller.detail('Bearer access-token', '1aef91f9-64c9-4548-baa5-d70b52386efb');

    expect(receiversService.detailInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });
    expect(backupContactsService.listInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      displayName: 'Fatima Parent',
      backupContacts: [
        {
          id: 'backup-contact-1',
          displayName: 'Backup Cousin',
          phoneMasked: '*******2222',
          relationshipToReceiver: 'Cousin',
          priorityOrder: 0,
          hasLocationInstructions: true,
          createdAt: '2026-04-29T08:00:00.000Z',
        },
      ],
      escalation: {
        configured: true,
        nextStep: 'Backup contacts configured',
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
      { pausedUntil: '2026-05-10T18:00:00.000Z' },
    );

    expect(receiversService.detailInput).toMatchObject({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: new Date('2026-05-10T18:00:00.000Z'),
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response.receiver).toMatchObject({
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      pausedUntil: '2026-05-10T18:00:00.000Z',
      pausedReason: 'USER_PAUSED',
    });
  });

  it('rejects an invalid receiver pause end date', async () => {
    const receiversService = new FakeReceiversService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    await expect(
      controller.pause(
        'Bearer access-token',
        '203.0.113.10',
        'Nearby Mobile/1.0',
        '1aef91f9-64c9-4548-baa5-d70b52386efb',
        { pausedUntil: 'not-a-date' },
      ),
    ).rejects.toThrow('pausedUntil must be a valid date');
    expect(receiversService.detailInput).toBeNull();
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
    const stepUpService = new FakeStepUpService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
      undefined,
      undefined,
      stepUpService as never,
    );

    const response = await controller.delete(
      'Bearer access-token',
      'receiver-remove-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
    );

    expect(stepUpService.consumedInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      action: SensitiveAction.REMOVE_RECEIVER,
      stepUpToken: 'receiver-remove-token',
    });
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

  it('blocks receiver creation until the sender has paid access', async () => {
    const receiversService = new FakeReceiversService();
    const receiverConsentService = new FakeReceiverConsentService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      receiverConsentService as never,
      undefined,
      new FakeBillingService(false) as never,
    );

    let error: unknown;

    try {
      await controller.create('Bearer access-token', 'Nearby Mobile/1.0', '203.0.113.10', {
        name: 'Fatima Parent',
        phone: '+971501234567',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'PAID_ACCESS_REQUIRED',
      message: 'Active subscription required to add receivers',
    });
    expect(receiversService.createInput).toBeNull();
    expect(receiverConsentService.requestInput).toBeNull();
  });

  it('rejects missing receiver enum fields as a bad request', async () => {
    const receiversService = new FakeReceiversService();
    const receiverConsentService = new FakeReceiverConsentService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      receiverConsentService as never,
      undefined,
      new FakeBillingService(true) as never,
    );

    await expect(
      controller.create('Bearer access-token', 'Nearby Mobile/1.0', '203.0.113.10', {
        name: 'Fatima Parent',
        phone: '+971501234567',
        countryCode: 'AE',
        language: 'en',
        timezone: 'Asia/Dubai',
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(receiversService.createInput).toBeNull();
    expect(receiverConsentService.requestInput).toBeNull();
  });

  it('maps receiver service validation failures to bad requests', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextCreateError = new Error('Receiver name is required');
    const receiverConsentService = new FakeReceiverConsentService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      receiverConsentService as never,
      undefined,
      new FakeBillingService(true) as never,
    );

    await expect(
      controller.create('Bearer access-token', 'Nearby Mobile/1.0', '203.0.113.10', {
        name: 'Fatima Parent',
        phone: '+971501234567',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(receiverConsentService.requestInput).toBeNull();
  });
});
