import { Channel, ConsentStatus, RelationshipType, TechProfile } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SupabaseAuthService } from '../auth/supabase-auth.service';
import type { UsersService } from '../users/users.service';
import type { ReceiverConsentService } from './receiver-consent.service';
import type { ReceiversService } from './receivers.service';
import { ReceiversController } from './receivers.controller';

describe('ReceiversController', () => {
  it('creates a receiver for the authenticated sender without leaking encrypted fields', async () => {
    const supabaseAuth = {
      verifyAccessToken: async () => ({
        authProviderId: 'supabase-user-123',
        email: 'sender@example.com',
        phone: '+971501234567',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    } satisfies Pick<SupabaseAuthService, 'verifyAccessToken'>;
    const users = {
      upsertFromSupabaseIdentity: async () => ({
        id: '61a5639c-c902-4950-9924-1a4d6db1e02d',
        authProviderId: 'supabase-user-123',
        emailEncrypted: 'encrypted-email',
        emailHash: 'email-hash',
        phoneEncrypted: 'encrypted-phone',
        phoneHash: 'phone-hash',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    } satisfies Pick<UsersService, 'upsertFromSupabaseIdentity'>;
    const receivers = {
      createForSender: async (input) => ({
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        userId: input.userId,
        nameEncrypted: 'encrypted-name',
        phoneEncrypted: 'encrypted-phone',
        phoneHash: 'receiver-phone-hash',
        countryCode: input.countryCode,
        relationshipType: input.relationshipType,
        language: input.language,
        timezone: input.timezone,
        techProfile: input.techProfile,
        primaryChannel: input.primaryChannel,
        fallbackChannels: input.fallbackChannels,
        scheduleFrequency: input.scheduleFrequency,
        scheduleTimeWindow: input.scheduleTimeWindow,
        scheduleCustomCron: input.scheduleCustomCron,
        personalNoteEncrypted: 'encrypted-note',
        consentStatus: ConsentStatus.PENDING,
        createdAt: new Date('2026-04-26T10:00:00.000Z'),
        updatedAt: new Date('2026-04-26T10:00:00.000Z'),
      }),
    } satisfies Pick<ReceiversService, 'createForSender'>;
    const consent = {
      requestConsent: async (input) => input.receiver,
    } satisfies Pick<ReceiverConsentService, 'requestConsent'>;
    const controller = new ReceiversController(
      supabaseAuth as unknown as SupabaseAuthService,
      users as unknown as UsersService,
      receivers as unknown as ReceiversService,
      consent as unknown as ReceiverConsentService,
    );

    const response = await controller.create(
      'Bearer access-token',
      'Nearby Mobile/1.0',
      '203.0.113.10',
      {
        name: 'Fatima Parent',
        phone: '050 123 4567',
        phoneCountry: 'AE',
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: {
          start: '09:00',
          end: '11:00',
        },
        personalNote: 'Please answer when you are free.',
      },
    );

    expect(response).toEqual({
      receiver: {
        id: '1aef91f9-64c9-4548-baa5-d70b52386efb',
        consentStatus: ConsentStatus.PENDING,
        countryCode: 'AE',
        relationshipType: RelationshipType.PARENT,
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: TechProfile.WHATSAPP,
        primaryChannel: Channel.WHATSAPP,
        fallbackChannels: [Channel.SMS, Channel.VOICE],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: {
          start: '09:00',
          end: '11:00',
        },
        consentRequestStatus: 'requested',
      },
    });
    expect(JSON.stringify(response)).not.toContain('encrypted');
    expect(JSON.stringify(response)).not.toContain('hash');
  });

  it('requires a bearer token', async () => {
    const controller = new ReceiversController(
      {} as SupabaseAuthService,
      {} as UsersService,
      {} as ReceiversService,
      {} as ReceiverConsentService,
    );

    await expect(controller.create(undefined, undefined, undefined, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.create('Basic bad-token', undefined, undefined, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
