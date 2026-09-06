import { Channel, ConsentStatus, RelationshipType, SensitiveAction, TechProfile } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ReceiverScheduleValidationError } from '../../shared/schedule/receiver-schedule';
import {
  CheckInInProgressError,
  ConsentResendLimitError,
  OptOutCooldownError,
  ReceiverAlreadyMonitoredError,
  RESOLUTION_NOTE_TOO_LONG_MESSAGE,
} from './receiver-policy';
import { ReceiversController } from './receivers.controller';
import { PERSONAL_NOTE_TOO_LONG_MESSAGE } from './receivers.service';

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
  public nextUpdateError: Error | null = null;
  /** Thrown by the next resolve / alert-backup / try-later call. */
  public nextActionError: Error | null = null;

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

  async pauseForSender(input: {
    userId: string;
    receiverId: string;
    pausedUntil?: Date;
    ipAddress?: string;
    userAgent?: string;
  }) {
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
    if (this.nextUpdateError) {
      throw this.nextUpdateError;
    }

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
    this.throwNextActionError();
    this.resolveInput = input;
    return {
      id: input.receiverId,
      latestCheckIn: {
        id: input.checkInId,
        status: 'RESOLVED',
        resolvedAt: '2026-04-30T10:00:00.000Z',
        resolutionByUserId: input.userId,
        resolutionNote: input.note,
      },
    };
  }

  async alertBackupForSender(input: Record<string, unknown>) {
    this.throwNextActionError();
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
    this.throwNextActionError();
    this.tryLaterInput = input;
    return {
      id: input.receiverId,
      latestCheckIn: {
        id: input.checkInId,
        status: 'SKIPPED',
      },
    };
  }

  private throwNextActionError() {
    if (this.nextActionError) {
      const error = this.nextActionError;
      this.nextActionError = null;
      throw error;
    }
  }
}

class FakeReceiverConsentService {
  public requestInput: Record<string, unknown> | null = null;
  public resendInput: Record<string, unknown> | null = null;
  /** When set, `requestConsent` behaves like a failed provider send: the receiver comes back unmarked. */
  public consentSendFails = false;
  public nextResendError: Error | null = null;
  public resendResult: { receiver: Record<string, unknown>; sent: boolean } | null = {
    receiver: {
      id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      consentStatus: ConsentStatus.PENDING,
      consentRequestedAt: new Date('2026-05-01T10:00:00.000Z'),
    },
    sent: true,
  };

  async requestConsent(input: { receiver: Record<string, unknown> } & Record<string, unknown>) {
    this.requestInput = input;
    return this.consentSendFails
      ? { ...input.receiver, consentRequestedAt: undefined }
      : { ...input.receiver, consentRequestedAt: new Date('2026-05-01T10:00:00.000Z') };
  }

  async resendConsent(input: Record<string, unknown>) {
    if (this.nextResendError) {
      throw this.nextResendError;
    }
    this.resendInput = input;
    return this.resendResult;
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

  it('maps an over-long personal note to a bad request before consent is requested', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextCreateError = new Error(PERSONAL_NOTE_TOO_LONG_MESSAGE);
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
        personalNote: 'x'.repeat(51),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(receiverConsentService.requestInput).toBeNull();
  });

  it('requests consent with a neutral sender name, never the sender email', async () => {
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
      personalNote: 'Take your pills at 8',
    });

    expect(receiversService.createInput).toMatchObject({ personalNote: 'Take your pills at 8' });
    expect(receiverConsentService.requestInput).toMatchObject({
      actorUserId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      senderDisplayName: 'your family member',
    });
    expect(JSON.stringify(receiverConsentService.requestInput)).not.toContain('sender@example.com');
  });
});

describe('ReceiversController rejects an invalid schedule with a code (CB-004)', () => {
  const body = {
    name: 'Fatima Parent',
    phone: '+971501234567',
    countryCode: 'AE',
    relationshipType: RelationshipType.PARENT,
    language: 'en',
    timezone: 'Dubai',
    techProfile: TechProfile.WHATSAPP,
    primaryChannel: Channel.WHATSAPP,
    fallbackChannels: [Channel.SMS],
    scheduleFrequency: 'daily',
    scheduleTimeWindow: { start: '09:00', end: '11:00' },
  };

  it('returns 400 with INVALID_TIMEZONE on create and requests no consent', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextCreateError = new ReceiverScheduleValidationError(
      'INVALID_TIMEZONE',
      'Receiver timezone must be an IANA time zone name such as Asia/Dubai',
    );
    const receiverConsentService = new FakeReceiverConsentService();
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      receiverConsentService as never,
      undefined,
      new FakeBillingService(true) as never,
    );

    const error = await controller.create('Bearer access-token', 'Nearby Mobile/1.0', '203.0.113.10', body).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'INVALID_TIMEZONE',
      message: 'Receiver timezone must be an IANA time zone name such as Asia/Dubai',
    });
    expect(receiverConsentService.requestInput).toBeNull();
  });

  it('returns 400 with INVALID_SCHEDULE_TIME_WINDOW on update', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextUpdateError = new ReceiverScheduleValidationError(
      'INVALID_SCHEDULE_TIME_WINDOW',
      'Receiver schedule time window start and end must use HH:mm (24-hour) format',
    );
    const controller = new ReceiversController(
      new FakeSupabaseAuthService() as never,
      new FakeUsersService() as never,
      receiversService as never,
      new FakeReceiverConsentService() as never,
    );

    const error = await controller
      .update('Bearer access-token', '203.0.113.10', 'Nearby Mobile/1.0', '1aef91f9-64c9-4548-baa5-d70b52386efb', {
        ...body,
        timezone: 'Asia/Dubai',
        scheduleTimeWindow: { start: '9:00', end: '11:00' },
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_SCHEDULE_TIME_WINDOW' });
    expect(receiversService.updateInput).toBeNull();
  });
});

const createBody = {
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
};

function controllerWith(receiversService: FakeReceiversService, consentService = new FakeReceiverConsentService()) {
  return new ReceiversController(
    new FakeSupabaseAuthService() as never,
    new FakeUsersService() as never,
    receiversService as never,
    consentService as never,
    undefined,
    new FakeBillingService(true) as never,
  );
}

async function rejectionOf(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('ReceiversController explains why a phone cannot be invited (CB-009, CB-014)', () => {
  it('returns 409 OPT_OUT_COOLDOWN with the cooldown end and requests no consent', async () => {
    const receiversService = new FakeReceiversService();
    const consentService = new FakeReceiverConsentService();
    receiversService.nextCreateError = new OptOutCooldownError(new Date('2026-05-07T10:00:00.000Z'));

    const error = await rejectionOf(
      controllerWith(receiversService, consentService).create(
        'Bearer access-token',
        'Nearby Mobile/1.0',
        '203.0.113.10',
        createBody,
      ),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'OPT_OUT_COOLDOWN',
      message: 'This person opted out of Nearby check-ins recently and cannot be invited again yet',
      cooldownUntil: '2026-05-07T10:00:00.000Z',
    });
    expect(consentService.requestInput).toBeNull();
  });

  it('returns 409 RECEIVER_ALREADY_MONITORED when another sender holds the phone', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextCreateError = new ReceiverAlreadyMonitoredError();

    const error = await rejectionOf(
      controllerWith(receiversService).create('Bearer access-token', 'Nearby Mobile/1.0', '203.0.113.10', createBody),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'RECEIVER_ALREADY_MONITORED' });
  });

  it('answers 201 with consentRequestStatus "failed" when the consent send fails, so the sender can resend', async () => {
    const receiversService = new FakeReceiversService();
    const consentService = new FakeReceiverConsentService();
    consentService.consentSendFails = true;

    const response = await controllerWith(receiversService, consentService).create(
      'Bearer access-token',
      'Nearby Mobile/1.0',
      '203.0.113.10',
      createBody,
    );

    expect(response.receiver).toMatchObject({ id: 'created-receiver-1', consentRequestStatus: 'failed' });
    expect(consentService.requestInput).not.toBeNull();
  });

  it('reports consentRequestStatus "requested" when the consent send succeeds', async () => {
    const response = await controllerWith(new FakeReceiversService()).create(
      'Bearer access-token',
      'Nearby Mobile/1.0',
      '203.0.113.10',
      createBody,
    );

    expect(response.receiver).toMatchObject({ consentRequestStatus: 'requested' });
  });
});

describe('ReceiversController resends a consent request (CB-009)', () => {
  it('asks the consent service with the sender, the receiver and a neutral display name', async () => {
    const consentService = new FakeReceiverConsentService();
    const controller = controllerWith(new FakeReceiversService(), consentService);

    const response = await controller.resendConsent(
      'Bearer access-token',
      '203.0.113.10, 198.51.100.7',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
    );

    expect(consentService.resendInput).toEqual({
      userId: '61a5639c-c902-4950-9924-1a4d6db1e02d',
      receiverId: '1aef91f9-64c9-4548-baa5-d70b52386efb',
      senderDisplayName: 'your family member',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
    expect(response).toEqual({
      receiver: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        consentStatus: ConsentStatus.PENDING,
        consentRequestStatus: 'requested',
        consentRequestedAt: '2026-05-01T10:00:00.000Z',
      },
    });
    expect(JSON.stringify(consentService.resendInput)).not.toContain('sender@example.com');
  });

  it('returns 429 CONSENT_RESEND_LIMIT with the next allowed time inside the 7-day window', async () => {
    const consentService = new FakeReceiverConsentService();
    consentService.nextResendError = new ConsentResendLimitError(new Date('2026-05-08T10:00:00.000Z'));

    const error = await rejectionOf(
      controllerWith(new FakeReceiversService(), consentService).resendConsent(
        'Bearer access-token',
        undefined,
        undefined,
        '1aef91f9-64c9-4548-baa5-d70b52386efb',
      ),
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      code: 'CONSENT_RESEND_LIMIT',
      message: 'A consent request was sent to this receiver in the last 7 days',
      nextAllowedAt: '2026-05-08T10:00:00.000Z',
    });
  });

  it('returns 404 when the receiver is not the sender’s', async () => {
    const consentService = new FakeReceiverConsentService();
    consentService.resendResult = null;

    const error = await rejectionOf(
      controllerWith(new FakeReceiversService(), consentService).resendConsent(
        'Bearer access-token',
        undefined,
        undefined,
        'missing-receiver',
      ),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });
});

describe('ReceiversController check-in actions (CB-017, CB-018)', () => {
  it('passes a trimmed resolution note through and returns it on the check-in', async () => {
    const receiversService = new FakeReceiversService();

    const response = await controllerWith(receiversService).resolveCheckIn(
      'Bearer access-token',
      '203.0.113.10',
      'Nearby Mobile/1.0',
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      'check-in-1',
      { note: '  Called her, all fine.  ' },
    );

    expect(receiversService.resolveInput).toMatchObject({ checkInId: 'check-in-1', note: 'Called her, all fine.' });
    expect(response.receiver).toMatchObject({ latestCheckIn: { resolutionNote: 'Called her, all fine.' } });
  });

  it('treats a blank note as no note', async () => {
    const receiversService = new FakeReceiversService();

    await controllerWith(receiversService).resolveCheckIn(
      'Bearer access-token',
      undefined,
      undefined,
      '1aef91f9-64c9-4548-baa5-d70b52386efb',
      'check-in-1',
      { note: '   ' },
    );

    expect(receiversService.resolveInput).toMatchObject({ note: undefined });
  });

  it('maps an over-long resolution note to 400', async () => {
    const receiversService = new FakeReceiversService();
    receiversService.nextActionError = new Error(RESOLUTION_NOTE_TOO_LONG_MESSAGE);

    const error = await rejectionOf(
      controllerWith(receiversService).resolveCheckIn(
        'Bearer access-token',
        undefined,
        undefined,
        '1aef91f9-64c9-4548-baa5-d70b52386efb',
        'check-in-1',
        { note: 'x'.repeat(201) },
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(RESOLUTION_NOTE_TOO_LONG_MESSAGE);
  });

  it('returns 409 CHECK_IN_IN_PROGRESS for try-later and alert-backup while the cascade is running', async () => {
    const receiversService = new FakeReceiversService();
    const controller = controllerWith(receiversService);

    receiversService.nextActionError = new CheckInInProgressError();
    const tryLater = await rejectionOf(
      controller.tryCheckInLater(
        'Bearer access-token',
        undefined,
        undefined,
        '1aef91f9-64c9-4548-baa5-d70b52386efb',
        'check-in-1',
      ),
    );
    receiversService.nextActionError = new CheckInInProgressError();
    const alertBackup = await rejectionOf(
      controller.alertBackupForCheckIn(
        'Bearer access-token',
        undefined,
        undefined,
        '1aef91f9-64c9-4548-baa5-d70b52386efb',
        'check-in-1',
      ),
    );

    for (const error of [tryLater, alertBackup]) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'CHECK_IN_IN_PROGRESS' });
    }
    expect(receiversService.tryLaterInput).toBeNull();
    expect(receiversService.alertBackupInput).toBeNull();
  });
});
