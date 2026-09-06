import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { InMemoryChannelTemplateRepository } from './channel-template.repository';
import {
  MalformedMessageTemplateError,
  MessageCatalogService,
  MissingMessageVariableError,
  UnknownMessageTemplateError,
  renderingAuditMetadata,
} from './message-catalog.service';
import {
  IN_CODE_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_KEYS,
  NEUTRAL_SENDER_DISPLAY_NAME,
  NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
  NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE,
  describeChannelsTried,
  localizeNeutralSenderDisplayName,
} from './message-catalog.templates';

/** Enough variables to render every in-code template. */
const allVariables = {
  receiverName: 'Fatima',
  senderDisplayName: 'Ahmed',
  personalNote: 'Take your pills at 8',
  contactName: 'Salma',
  channelsTried: 'WhatsApp and SMS',
  locationInstructions: 'Flat 12, blue door',
  reason: 'missed_check_in',
  code: '123456',
  validityMinutes: '10',
};

describe('MessageCatalogService', () => {
  it('renders every in-code template key in English without leaving a placeholder behind', async () => {
    const catalog = new MessageCatalogService();

    for (const templateKey of MESSAGE_TEMPLATE_KEYS) {
      const rendered = await catalog.render({ templateKey, language: 'en', variables: allVariables });

      expect(rendered.fallback, templateKey).toBe(false);
      expect(rendered.language, templateKey).toBe('en');
      expect(rendered.body, templateKey).not.toMatch(/\{\{|\}\}/);
      expect(rendered.body, templateKey).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(rendered.body.length, templateKey).toBeGreaterThan(20);
    }
    expect(Object.keys(IN_CODE_MESSAGE_TEMPLATES).sort()).toEqual([...MESSAGE_TEMPLATE_KEYS].sort());
  });

  it('writes a daily check-in as a warm sentence naming both people, carrying the note and the reply keywords', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'checkin_daily',
      language: 'en',
      variables: {
        receiverName: 'Fatima',
        senderDisplayName: 'your family member',
        personalNote: 'Take your pills at 8',
      },
    });

    expect(rendered.body).toBe(
      'Hi Fatima, your family member is checking in on you today. Their note: "Take your pills at 8" ' +
        "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.",
    );
  });

  it('drops the note sentence when there is no personal note', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'checkin_daily',
      language: 'en',
      variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
    });

    expect(rendered.body).toBe(
      "Hi Fatima, Ahmed is checking in on you today. Reply YES if you're okay or HELP if you need help. " +
        'Reply STOP to stop, REPORT to report.',
    );
    expect(rendered.body).not.toContain('Their note');
  });

  it('reads the OTP as a sentence with the code and its validity', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'account_step_up_otp',
      language: 'en',
      variables: { code: '482913', validityMinutes: '10' },
    });

    expect(rendered.body).toBe(
      'Your Nearby verification code is 482913. It is valid for 10 minutes. Do not share this code with anyone.',
    );
  });

  it('tells a backup contact who, what happened, what was tried, where to go, and how to reply', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'backup_contact_missed_checkin_alert',
      language: 'en',
      variables: allVariables,
    });

    expect(rendered.body).toBe(
      "Hi Salma, this is Nearby. Fatima did not answer today's check-in from Ahmed. We tried WhatsApp and SMS. " +
        'Please check on them. Where to find them: Flat 12, blue door Reply DONE once you have reached them.',
    );
  });

  it('falls back to English with fallback: true when the language has no copy', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'checkin_daily',
      language: 'ar',
      variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed', personalNote: 'Call me after lunch' },
    });

    expect(rendered).toEqual({
      body:
        'Hi Fatima, Ahmed is checking in on you today. Their note: "Call me after lunch" ' +
        "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.",
      language: 'en',
      fallback: true,
    });
  });

  it('treats regional English as English rather than a fallback', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'receiver_checkins_ended',
      language: 'en-GB',
      variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
    });

    expect(rendered.language).toBe('en');
    expect(rendered.fallback).toBe(false);
  });

  it('prefers an active channel_templates row for the requested language and channel over in-code copy', async () => {
    const templates = new InMemoryChannelTemplateRepository([
      { templateKey: 'checkin_daily', language: 'ar', channel: Channel.SMS, bodyText: 'مرحبا {{receiverName}}' },
      { templateKey: 'checkin_daily', language: 'ar', channel: Channel.WHATSAPP, bodyText: 'inactive', active: false },
    ]);
    const catalog = new MessageCatalogService(templates);
    const variables = { receiverName: 'Fatima', senderDisplayName: 'Ahmed' };

    await expect(
      catalog.render({ templateKey: 'checkin_daily', language: 'ar', channel: Channel.SMS, variables }),
    ).resolves.toEqual({
      body: 'مرحبا Fatima',
      language: 'ar',
      fallback: false,
    });
    await expect(
      catalog.render({ templateKey: 'checkin_daily', language: 'ar', channel: Channel.WHATSAPP, variables }),
    ).resolves.toMatchObject({ language: 'en', fallback: true });
    await expect(catalog.render({ templateKey: 'checkin_daily', language: 'ar', variables })).resolves.toMatchObject({
      language: 'en',
      fallback: true,
    });
  });

  it('uses an active English database row on fallback before the in-code English copy', async () => {
    const templates = new InMemoryChannelTemplateRepository([
      { templateKey: 'checkin_daily', language: 'en', channel: Channel.SMS, bodyText: 'Hello {{receiverName}}' },
    ]);

    await expect(
      new MessageCatalogService(templates).render({
        templateKey: 'checkin_daily',
        language: 'hi',
        channel: Channel.SMS,
        variables: { receiverName: 'Fatima' },
      }),
    ).resolves.toEqual({ body: 'Hello Fatima', language: 'en', fallback: true });
  });

  it('fails closed when a required variable is missing or blank', async () => {
    const catalog = new MessageCatalogService();

    await expect(
      catalog.render({ templateKey: 'checkin_daily', language: 'en', variables: { senderDisplayName: 'Ahmed' } }),
    ).rejects.toThrow(MissingMessageVariableError);
    await expect(
      catalog.render({
        templateKey: 'checkin_daily',
        language: 'en',
        variables: { receiverName: '   ', senderDisplayName: 'Ahmed' },
      }),
    ).rejects.toThrow('Message template checkin_daily requires variable "receiverName"');
  });

  it('fails closed on a database row with a malformed placeholder instead of sending it', async () => {
    const templates = new InMemoryChannelTemplateRepository([
      { templateKey: 'checkin_daily', language: 'en', channel: Channel.SMS, bodyText: 'Hi {{receiverName}, {{/oops}}' },
    ]);

    await expect(
      new MessageCatalogService(templates).render({
        templateKey: 'checkin_daily',
        language: 'en',
        channel: Channel.SMS,
        variables: { receiverName: 'Fatima' },
      }),
    ).rejects.toThrow(MalformedMessageTemplateError);
  });

  it('does not let a variable value inject a placeholder', async () => {
    const rendered = await new MessageCatalogService().render({
      templateKey: 'receiver_checkins_ended',
      language: 'en',
      variables: { receiverName: '{{senderDisplayName}}', senderDisplayName: 'Ahmed' },
    });

    expect(rendered.body.startsWith('Hi {{senderDisplayName}}, Ahmed has ended')).toBe(true);
  });

  it('throws a typed error for an unknown template key', async () => {
    await expect(
      new MessageCatalogService().render({ templateKey: 'not_a_template', language: 'en', variables: {} }),
    ).rejects.toThrow(UnknownMessageTemplateError);
  });

  it('summarises rendering for audit metadata without any message text', () => {
    expect(renderingAuditMetadata({ language: 'en', fallback: true })).toEqual({
      renderedLanguage: 'en',
      renderFallback: true,
    });
    expect(renderingAuditMetadata(undefined)).toEqual({});
  });
});

describe('neutral sender wording follows the rendered language (CB-079)', () => {
  const SEED_LANGUAGES = ['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn'];
  const arabicTemplates = new InMemoryChannelTemplateRepository([
    {
      templateKey: 'receiver_checkins_ended',
      language: 'ar',
      channel: Channel.SMS,
      bodyText: 'مرحباً {{receiverName}}، تم إنهاء رسائل الاطمئنان من Nearby بطلب من {{senderDisplayName}}.',
    },
    {
      templateKey: 'backup_contact_help_alert',
      language: 'ar',
      channel: Channel.SMS,
      bodyText:
        'مرحباً {{contactName}}، وصلنا طلب مساعدة من {{receiverName}} أثناء رسالة اطمئنان من {{senderDisplayName}}.',
    },
  ]);

  it('has both phrases for every seeded language, each in its own script', () => {
    for (const language of SEED_LANGUAGES) {
      const phrases = NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE[language];
      expect(phrases, language).toBeDefined();
      expect(phrases?.receiver.trim().length, language).toBeGreaterThan(0);
      expect(phrases?.backupContact.trim().length, language).toBeGreaterThan(0);
      if (language !== 'en' && language !== 'es') {
        expect(phrases?.receiver, language).not.toMatch(/[A-Za-z]/);
        expect(phrases?.backupContact, language).not.toMatch(/[A-Za-z]/);
      }
    }
    expect(NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE.en).toEqual({
      receiver: NEUTRAL_SENDER_DISPLAY_NAME,
      backupContact: NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
    });
  });

  it('swaps the English constants for the phrase of the language and leaves everything else alone', () => {
    expect(localizeNeutralSenderDisplayName(NEUTRAL_SENDER_DISPLAY_NAME, 'ar')).toBe('أحد أفراد عائلتك');
    expect(localizeNeutralSenderDisplayName(NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS, 'ar-EG')).toBe(
      'أحد أفراد العائلة',
    );
    expect(localizeNeutralSenderDisplayName(NEUTRAL_SENDER_DISPLAY_NAME, 'en-GB')).toBe(NEUTRAL_SENDER_DISPLAY_NAME);
    expect(localizeNeutralSenderDisplayName(NEUTRAL_SENDER_DISPLAY_NAME, 'fr')).toBe(NEUTRAL_SENDER_DISPLAY_NAME);
    expect(localizeNeutralSenderDisplayName('Ahmed', 'ar')).toBe('Ahmed');
    expect(localizeNeutralSenderDisplayName('your family members', 'ar')).toBe('your family members');
  });

  it('renders an Arabic STOP confirmation for a sender without a name with no English inside it', async () => {
    const rendered = await new MessageCatalogService(arabicTemplates).render({
      templateKey: 'receiver_checkins_ended',
      language: 'ar',
      channel: Channel.SMS,
      variables: { receiverName: 'فاطمة', senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME },
    });

    expect(rendered.language).toBe('ar');
    expect(rendered.body).toBe('مرحباً فاطمة، تم إنهاء رسائل الاطمئنان من Nearby بطلب من أحد أفراد عائلتك.');
    expect(rendered.body).not.toMatch(/family member/i);
  });

  it('uses the backup-contact phrase for the backup-contact constant', async () => {
    const rendered = await new MessageCatalogService(arabicTemplates).render({
      templateKey: 'backup_contact_help_alert',
      language: 'ar',
      channel: Channel.SMS,
      variables: {
        contactName: 'سلمى',
        receiverName: 'فاطمة',
        senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
      },
    });

    expect(rendered.body).toContain('من أحد أفراد العائلة.');
    expect(rendered.body).not.toMatch(/family member/i);
  });

  it('keeps the English wording when the copy falls back to English, and never touches a real name', async () => {
    const fallback = await new MessageCatalogService(arabicTemplates).render({
      templateKey: 'checkin_daily',
      language: 'ar',
      channel: Channel.SMS,
      variables: { receiverName: 'Fatima', senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME },
    });
    const named = await new MessageCatalogService(arabicTemplates).render({
      templateKey: 'receiver_checkins_ended',
      language: 'ar',
      channel: Channel.SMS,
      variables: { receiverName: 'فاطمة', senderDisplayName: 'Ahmed' },
    });

    expect(fallback).toMatchObject({ language: 'en', fallback: true });
    expect(fallback.body).toContain('your family member is checking in on you today');
    expect(named.body).toContain('بطلب من Ahmed.');
  });
});

describe('describeChannelsTried', () => {
  it('lists channels in plain words, once each, in the order they were tried', () => {
    expect(describeChannelsTried([])).toBe('');
    expect(describeChannelsTried([Channel.SMS])).toBe('SMS');
    expect(describeChannelsTried([Channel.WHATSAPP, Channel.SMS, Channel.WHATSAPP])).toBe('WhatsApp and SMS');
    expect(describeChannelsTried([Channel.WHATSAPP, Channel.SMS, Channel.VOICE])).toBe(
      'WhatsApp, SMS and a phone call',
    );
  });
});
