import { Channel } from '@prisma/client';

/**
 * In-code message copy, keyed by template key then language. This is the floor: an active `channel_templates`
 * row for the same (key, language, channel) wins, and any language without copy here falls back to English.
 * The eight launch languages are seeded into `channel_templates` by migration
 * `202609060103_seed_channel_templates_8_languages` (English rows identical to this copy, asserted by
 * `message-catalog.seed.spec.ts`); this file stays as the last-resort fallback when the table is empty.
 *
 * Syntax (shared with database rows):
 *   {{name}}                 required variable; rendering fails closed when it is missing or blank
 *   {{#name}}...{{/name}}    optional section, included only when `name` is present and non-blank
 *
 * Copy rules: plain, warm, short (SMS is billed per 160 GSM-7 characters), no emoji, always names the receiver
 * and the sender, carries the personal note when there is one, and every receiver-facing message ends with the
 * reply keywords the inbound parser understands (YES / HELP / STOP / REPORT; backup contacts reply DONE).
 */
export const MESSAGE_TEMPLATE_KEYS = [
  'consent_request',
  'checkin_daily',
  'checkin_retry',
  'receiver_checkins_paused',
  'receiver_checkins_ended',
  'account_step_up_otp',
  'backup_contact_missed_checkin_alert',
  'backup_contact_help_alert',
  'backup_contact_sender_requested_alert',
] as const;

export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const DEFAULT_MESSAGE_LANGUAGE = 'en';

/** Receiver-facing stand-in until the sender's own name is stored (later CB-010 slice); never the email. */
export const NEUTRAL_SENDER_DISPLAY_NAME = 'your family member';
/** Same stand-in seen from a backup contact's side. */
export const NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS = 'their family member';
/** Used in a backup alert only if the receiver row could not be read (deleted mid-escalation). */
export const NEUTRAL_RECEIVER_NAME_FOR_BACKUP_CONTACTS = 'the person you are a backup contact for';
/** Greeting when a receiver name is unavailable ("Hi there,"). */
export const NEUTRAL_RECEIVER_GREETING_NAME = 'there';

const CHECK_IN_REPLY_FOOTER =
  "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.";
const BACKUP_REPLY_FOOTER = 'Reply DONE once you have reached them.';
const PERSONAL_NOTE_SECTION = '{{#personalNote}} Their note: "{{personalNote}}"{{/personalNote}}';
const LOCATION_SECTION =
  '{{#locationInstructions}} Where to find them: {{locationInstructions}}{{/locationInstructions}}';

export const IN_CODE_MESSAGE_TEMPLATES: Record<MessageTemplateKey, Record<string, string>> = {
  consent_request: {
    en:
      'Hi {{receiverName}}, {{senderDisplayName}} asked Nearby to check in on you with a short daily message.' +
      PERSONAL_NOTE_SECTION +
      ' Reply YES to agree. Reply STOP to stop, REPORT to report.',
  },
  checkin_daily: {
    en:
      'Hi {{receiverName}}, {{senderDisplayName}} is checking in on you today.' +
      PERSONAL_NOTE_SECTION +
      ` ${CHECK_IN_REPLY_FOOTER}`,
  },
  checkin_retry: {
    en:
      'Hi {{receiverName}}, we have not heard back from you yet. {{senderDisplayName}} is checking in on you.' +
      PERSONAL_NOTE_SECTION +
      ` ${CHECK_IN_REPLY_FOOTER}`,
  },
  receiver_checkins_paused: {
    en:
      'Hi {{receiverName}}, {{senderDisplayName}} has paused your Nearby check-ins. You will not get check-in ' +
      'messages until they are resumed. Reply STOP to stop, REPORT to report.',
  },
  receiver_checkins_ended: {
    en:
      'Hi {{receiverName}}, {{senderDisplayName}} has ended your Nearby check-ins. You will not get any more ' +
      'check-in messages. Reply REPORT to report.',
  },
  account_step_up_otp: {
    en:
      'Your Nearby verification code is {{code}}. It is valid for {{validityMinutes}} minutes. ' +
      'Do not share this code with anyone.',
  },
  backup_contact_missed_checkin_alert: {
    en:
      "Hi {{contactName}}, this is Nearby. {{receiverName}} did not answer today's check-in from " +
      '{{senderDisplayName}}.{{#channelsTried}} We tried {{channelsTried}}.{{/channelsTried}} Please check on them.' +
      LOCATION_SECTION +
      ` ${BACKUP_REPLY_FOOTER}`,
  },
  backup_contact_help_alert: {
    en:
      'Hi {{contactName}}, this is Nearby. {{receiverName}} asked for help during a check-in from ' +
      '{{senderDisplayName}}.{{#channelsTried}} We reached them by {{channelsTried}}.{{/channelsTried}} ' +
      'Please contact them now.' +
      LOCATION_SECTION +
      ` ${BACKUP_REPLY_FOOTER}`,
  },
  backup_contact_sender_requested_alert: {
    en:
      'Hi {{contactName}}, this is Nearby. {{senderDisplayName}} asked us to alert you about {{receiverName}} ' +
      'and would like you to check on them.{{#channelsTried}} We tried {{channelsTried}}.{{/channelsTried}}' +
      LOCATION_SECTION +
      ` ${BACKUP_REPLY_FOOTER}`,
  },
};

const CHANNEL_LABELS: Record<Channel, string> = {
  [Channel.WHATSAPP]: 'WhatsApp',
  [Channel.SMS]: 'SMS',
  [Channel.VOICE]: 'a phone call',
};

/**
 * Human wording for the channels a check-in cascade already used, e.g. "WhatsApp and SMS". Returns an empty
 * string when nothing was tried so templates can drop the sentence via an optional section.
 */
export function describeChannelsTried(channels: readonly Channel[]): string {
  const labels = channels
    .filter((channel, index, all) => all.indexOf(channel) === index)
    .map((channel) => CHANNEL_LABELS[channel]);

  if (labels.length === 0) {
    return '';
  }
  if (labels.length === 1) {
    return labels[0] ?? '';
  }

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
