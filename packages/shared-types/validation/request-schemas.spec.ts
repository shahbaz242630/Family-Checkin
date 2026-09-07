import { describe, expect, it } from 'vitest';
import { createBackupContactBodySchema, updateBackupContactBodySchema } from './backup-contacts';
import {
  createReceiverBodySchema,
  DEFAULT_CHECK_IN_HISTORY_DAYS,
  fakeInboundReceiverReplyBodySchema,
  MAX_CHECK_IN_HISTORY_DAYS,
  pauseReceiverBodySchema,
  receiverCheckInHistoryQuerySchema,
  resolveCheckInBodySchema,
  updateReceiverBodySchema,
} from './receivers';
import { registerDeviceTokenBodySchema } from './notifications';
import { stepUpRequestBodySchema, stepUpVerifyBodySchema } from './account';
import { revenueCatWebhookBodySchema } from './billing';
import { twilioMessagingWebhookBodySchema, twilioVoiceStatusWebhookBodySchema } from './provider-webhooks';
import {
  dialablePhoneSchema,
  e164PhoneSchema,
  isIanaTimeZone,
  MAX_PERSONAL_NOTE_LENGTH,
  MAX_RESOLUTION_NOTE_LENGTH,
  timeOfDaySchema,
  timeZoneSchema,
} from './primitives';

const validReceiver = {
  name: 'Fatima Parent',
  phone: '+971501234567',
  countryCode: 'AE',
  relationshipType: 'PARENT',
  language: 'en',
  timezone: 'Asia/Dubai',
  techProfile: 'WHATSAPP',
  primaryChannel: 'WHATSAPP',
  fallbackChannels: ['SMS'],
  scheduleFrequency: 'daily',
  scheduleTimeWindow: { start: '09:00', end: '11:00' },
};

/** The issue paths of a failed parse, sorted, so a spec can name the fields that were refused. */
function refusedFields(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } },
  body: unknown,
): string[] {
  const result = schema.safeParse(body);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => issue.path.map((segment) => String(segment)).join('.')).sort();
}

describe('createReceiverBodySchema (CB-042)', () => {
  it('accepts the body the app posts', () => {
    const result = createReceiverBodySchema.safeParse({ ...validReceiver, personalNote: 'Call me after' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      countryCode: 'AE',
      primaryChannel: 'WHATSAPP',
      fallbackChannels: ['SMS'],
      scheduleTimeWindow: { start: '09:00', end: '11:00' },
    });
  });

  it("refuses primaryChannel 'EMAIL' — the backlog's first acceptance case", () => {
    expect(refusedFields(createReceiverBodySchema, { ...validReceiver, primaryChannel: 'EMAIL' })).toEqual([
      'primaryChannel',
    ]);
  });

  it("refuses fallbackChannels: 'SMS' — a string where the array belongs, the second acceptance case", () => {
    expect(refusedFields(createReceiverBodySchema, { ...validReceiver, fallbackChannels: 'SMS' })).toEqual([
      'fallbackChannels',
    ]);
  });

  it('defaults fallbackChannels to an empty list rather than failing', () => {
    const { fallbackChannels: _ignored, ...withoutFallbacks } = validReceiver;

    expect(createReceiverBodySchema.parse(withoutFallbacks).fallbackChannels).toEqual([]);
  });

  it('refuses a timezone the scheduler could not evaluate (CB-004)', () => {
    expect(refusedFields(createReceiverBodySchema, { ...validReceiver, timezone: 'Dubai' })).toEqual(['timezone']);
  });

  it('refuses a schedule window that is not HH:mm on a 24-hour clock', () => {
    expect(
      refusedFields(createReceiverBodySchema, {
        ...validReceiver,
        scheduleTimeWindow: { start: '9:00', end: '25:00' },
      }),
    ).toEqual(['scheduleTimeWindow.end', 'scheduleTimeWindow.start']);
  });

  it('refuses a country code that would not fit the char(2) column', () => {
    expect(refusedFields(createReceiverBodySchema, { ...validReceiver, countryCode: 'UAE' })).toEqual(['countryCode']);
  });

  it('upper-cases the country code so a lower-case one is not a database error', () => {
    expect(createReceiverBodySchema.parse({ ...validReceiver, countryCode: 'ae' }).countryCode).toBe('AE');
  });

  it('refuses a personal note over the 50 characters that ride inside a check-in message', () => {
    expect(
      refusedFields(createReceiverBodySchema, {
        ...validReceiver,
        personalNote: 'x'.repeat(MAX_PERSONAL_NOTE_LENGTH + 1),
      }),
    ).toEqual(['personalNote']);
  });

  it('counts an emoji note in code points, the way the service counts it', () => {
    const note = '🙂'.repeat(MAX_PERSONAL_NOTE_LENGTH);

    expect(createReceiverBodySchema.safeParse({ ...validReceiver, personalNote: note }).success).toBe(true);
    expect(createReceiverBodySchema.safeParse({ ...validReceiver, personalNote: `${note}🙂` }).success).toBe(false);
  });

  it('drops fields no route asked for instead of passing them to the service', () => {
    const parsed = createReceiverBodySchema.parse({ ...validReceiver, consentStatus: 'GRANTED', userId: 'someone' });

    expect(parsed).not.toHaveProperty('consentStatus');
    expect(parsed).not.toHaveProperty('userId');
  });

  it('refuses a body that is not an object at all', () => {
    expect(createReceiverBodySchema.safeParse('receiver').success).toBe(false);
    expect(createReceiverBodySchema.safeParse(null).success).toBe(false);
  });
});

describe('updateReceiverBodySchema (CB-042)', () => {
  it('takes the same profile fields as create, without the phone', () => {
    const parsed = updateReceiverBodySchema.parse({ ...validReceiver, phone: '+971501234567' });

    expect(parsed).not.toHaveProperty('phone');
    expect(parsed.timezone).toBe('Asia/Dubai');
  });
});

describe('pause and resolve bodies (CB-042)', () => {
  it('accepts an absent body', () => {
    expect(pauseReceiverBodySchema.parse({})).toEqual({});
    expect(resolveCheckInBodySchema.parse({})).toEqual({});
  });

  it('refuses a pausedUntil that is not a date', () => {
    expect(refusedFields(pauseReceiverBodySchema, { pausedUntil: 'not-a-date' })).toEqual(['pausedUntil']);
  });

  it('refuses a resolution note over 200 characters and trims a short one', () => {
    expect(refusedFields(resolveCheckInBodySchema, { note: 'x'.repeat(MAX_RESOLUTION_NOTE_LENGTH + 1) })).toEqual([
      'note',
    ]);
    expect(resolveCheckInBodySchema.parse({ note: '  she is fine  ' }).note).toBe('she is fine');
  });
});

describe('backup contact bodies (CB-042)', () => {
  it('accepts what the detail screen posts', () => {
    expect(
      createBackupContactBodySchema.safeParse({
        name: 'Ahmed Neighbour',
        phone: '+971507654321',
        relationshipToReceiver: 'Neighbour',
        locationInstructions: 'Flat 12, second floor',
      }).success,
    ).toBe(true);
  });

  it('requires a phone on create and allows keeping the stored one on update', () => {
    expect(refusedFields(createBackupContactBodySchema, { name: 'A', relationshipToReceiver: 'Cousin' })).toEqual([
      'phone',
    ]);
    expect(updateBackupContactBodySchema.safeParse({ name: 'A', relationshipToReceiver: 'Cousin' }).success).toBe(true);
  });
});

describe('device token, step-up and RevenueCat bodies (CB-042)', () => {
  it('refuses a platform outside ios, android and web', () => {
    expect(refusedFields(registerDeviceTokenBodySchema, { token: 'ExpoPushToken[abc]', platform: 'desktop' })).toEqual([
      'platform',
    ]);
  });

  it('refuses a sensitive action the account routes do not support', () => {
    expect(stepUpRequestBodySchema.safeParse({ action: 'EXPORT_DATA' }).success).toBe(true);
    expect(refusedFields(stepUpRequestBodySchema, { action: 'DROP_TABLES' })).toEqual(['action']);
  });

  it('refuses a step-up code that is too short or absurdly long', () => {
    expect(stepUpVerifyBodySchema.safeParse({ challengeId: 'challenge-1', code: '123456' }).success).toBe(true);
    expect(refusedFields(stepUpVerifyBodySchema, { challengeId: 'challenge-1', code: '12' })).toEqual(['code']);
  });

  it('keeps the RevenueCat body permissive: shape is checked, requiredness stays with the controller', () => {
    expect(revenueCatWebhookBodySchema.safeParse({ event: {} }).success).toBe(true);
    expect(refusedFields(revenueCatWebhookBodySchema, { event: { purchased_at_ms: 'yesterday' } })).toEqual([
      'event.purchased_at_ms',
    ]);
  });
});

describe('Twilio webhook bodies stay loose so the signature still matches (CB-042)', () => {
  it('keeps every field Twilio posted, including the ones the controller never reads', () => {
    const posted = {
      From: '+971501234567',
      Body: 'YES',
      MessageSid: 'SM123',
      AccountSid: 'AC123',
      NumMedia: '0',
      ApiVersion: '2010-04-01',
    };

    expect(twilioMessagingWebhookBodySchema.parse(posted)).toEqual(posted);
  });

  it('accepts a status callback with nothing but unknown fields', () => {
    expect(twilioVoiceStatusWebhookBodySchema.parse({ Unexpected: 'field' })).toEqual({ Unexpected: 'field' });
  });
});

describe('the fake reply route keeps answering for unusable senders (CB-015)', () => {
  it('accepts a short code so the pipeline can audit it as invalid_sender', () => {
    expect(
      fakeInboundReceiverReplyBodySchema.safeParse({ fromPhone: '12345', channel: 'SMS', body: 'YES' }).success,
    ).toBe(true);
  });

  it('still refuses a channel that does not exist', () => {
    expect(
      refusedFields(fakeInboundReceiverReplyBodySchema, { fromPhone: '+971501234567', channel: 'EMAIL', body: 'YES' }),
    ).toEqual(['channel']);
  });
});

describe('primitives (CB-042)', () => {
  it('accepts IANA zone names and link names, and refuses city names', () => {
    expect(isIanaTimeZone('Asia/Dubai')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Dubai')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(timeZoneSchema.safeParse('Europe/London').success).toBe(true);
  });

  it('accepts HH:mm on a 24-hour clock only', () => {
    for (const value of ['00:00', '09:05', '23:59']) {
      expect(timeOfDaySchema.safeParse(value).success, value).toBe(true);
    }
    for (const value of ['9:00', '24:00', '12:60', '12', '12:0a']) {
      expect(timeOfDaySchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('holds an international number to E.164 while letting a national number through', () => {
    expect(e164PhoneSchema.safeParse('+971501234567').success).toBe(true);
    expect(e164PhoneSchema.safeParse('0501234567').success).toBe(false);

    expect(dialablePhoneSchema.safeParse('+971 50 123 4567').success).toBe(true);
    expect(dialablePhoneSchema.safeParse('0501234567').success).toBe(true);
    expect(dialablePhoneSchema.safeParse('+0501234567').success).toBe(false);
    expect(dialablePhoneSchema.safeParse('+971').success).toBe(false);
    expect(dialablePhoneSchema.safeParse('DROP TABLE receivers').success).toBe(false);
  });
});

describe('receiverCheckInHistoryQuerySchema (CB-036)', () => {
  it('defaults to 30 days when the caller asks for no window', () => {
    expect(receiverCheckInHistoryQuerySchema.parse({})).toEqual({ days: DEFAULT_CHECK_IN_HISTORY_DAYS });
  });

  it('coerces the query string, which always arrives as text', () => {
    expect(receiverCheckInHistoryQuerySchema.parse({ days: '7' })).toEqual({ days: 7 });
    expect(receiverCheckInHistoryQuerySchema.parse({ days: 90 })).toEqual({ days: MAX_CHECK_IN_HISTORY_DAYS });
  });

  it('bounds the window: an unbounded days would be a full-table read for any signed-in caller', () => {
    for (const days of ['0', '-1', '91', '999999', '1.5', 'lots', '', ['1', '2'], null]) {
      expect(receiverCheckInHistoryQuerySchema.safeParse({ days }).success).toBe(false);
    }
  });
});
