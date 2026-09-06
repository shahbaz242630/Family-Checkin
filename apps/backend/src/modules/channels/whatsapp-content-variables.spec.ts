import { describe, expect, it } from 'vitest';
import { MissingMessageVariableError } from './message-catalog.service';
import { IN_CODE_MESSAGE_TEMPLATES } from './message-catalog.templates';
import {
  optionalSectionsOf,
  whatsappContentVariables,
  whatsappTemplateText,
  whatsappVariantCandidates,
  whatsappVariantKey,
} from './whatsapp-content-variables';

const CHECKIN_DAILY_EN = IN_CODE_MESSAGE_TEMPLATES.checkin_daily.en ?? '';
const BACKUP_EN = IN_CODE_MESSAGE_TEMPLATES.backup_contact_missed_checkin_alert.en ?? '';

describe('WhatsApp content variables (CB-020)', () => {
  it('lists the optional sections of a template in order of appearance', () => {
    expect(optionalSectionsOf(CHECKIN_DAILY_EN)).toEqual(['personalNote']);
    expect(optionalSectionsOf(BACKUP_EN)).toEqual(['channelsTried', 'locationInstructions']);
    expect(optionalSectionsOf(IN_CODE_MESSAGE_TEMPLATES.receiver_checkins_ended.en ?? '')).toEqual([]);
  });

  it('numbers placeholders by first appearance in the plain variant, dropping every optional section', () => {
    expect(whatsappTemplateText(CHECKIN_DAILY_EN, [])).toEqual({
      text:
        "Hi {{1}}, {{2}} is checking in on you today. Reply YES if you're okay or HELP if you need help. " +
        'Reply STOP to stop, REPORT to report.',
      placeholders: ['receiverName', 'senderDisplayName'],
    });
  });

  it('keeps exactly the sections of the variant and numbers their placeholders after the required ones', () => {
    expect(whatsappTemplateText(CHECKIN_DAILY_EN, ['personalNote'])).toEqual({
      text:
        'Hi {{1}}, {{2}} is checking in on you today. Their note: "{{3}}" ' +
        "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.",
      placeholders: ['receiverName', 'senderDisplayName', 'personalNote'],
    });
    expect(whatsappTemplateText(BACKUP_EN, ['locationInstructions'])).toEqual({
      text:
        "Hi {{1}}, this is Nearby. {{2}} did not answer today's check-in from {{3}}. Please check on them. " +
        'Where to find them: {{4}} Reply DONE once you have reached them.',
      placeholders: ['contactName', 'receiverName', 'senderDisplayName', 'locationInstructions'],
    });
  });

  it('gives a variable used twice one number, as the seeded Arabic check-in does with the sender', () => {
    const arabic =
      'مرحباً {{receiverName}}، هذه رسالة من {{senderDisplayName}} للاطمئنان عليك اليوم.' +
      '{{#personalNote}} ملاحظة من {{senderDisplayName}}: "{{personalNote}}"{{/personalNote}} أرسل YES.';

    expect(whatsappTemplateText(arabic, ['personalNote'])).toEqual({
      text: 'مرحباً {{1}}، هذه رسالة من {{2}} للاطمئنان عليك اليوم. ملاحظة من {{2}}: "{{3}}" أرسل YES.',
      placeholders: ['receiverName', 'senderDisplayName', 'personalNote'],
    });
  });

  it('names variants by the sections they keep', () => {
    expect(whatsappVariantKey('checkin_daily', [])).toBe('checkin_daily');
    expect(whatsappVariantKey('checkin_daily', ['personalNote'])).toBe('checkin_daily+personalNote');
    expect(whatsappVariantKey('backup_contact_help_alert', ['channelsTried', 'locationInstructions'])).toBe(
      'backup_contact_help_alert+channelsTried+locationInstructions',
    );
  });

  it('tries the most specific variant first and the plain one last', () => {
    const sections = ['channelsTried', 'locationInstructions'];

    expect(whatsappVariantCandidates(sections, new Set(['channelsTried', 'locationInstructions', 'other']))).toEqual([
      ['channelsTried', 'locationInstructions'],
      ['channelsTried'],
      ['locationInstructions'],
      [],
    ]);
    expect(whatsappVariantCandidates(sections, new Set(['locationInstructions']))).toEqual([
      ['locationInstructions'],
      [],
    ]);
    expect(whatsappVariantCandidates(sections, new Set())).toEqual([[]]);
    expect(whatsappVariantCandidates([], new Set(['personalNote']))).toEqual([[]]);
  });

  it('builds numbered ContentVariables, fails closed on a blank required value and flattens newlines', () => {
    expect(
      whatsappContentVariables('checkin_daily', ['receiverName', 'senderDisplayName', 'personalNote'], {
        receiverName: ' Salma ',
        senderDisplayName: 'Ahmed',
        personalNote: 'Take your pills\nat 8',
        unused: 'ignored',
      }),
    ).toEqual({ '1': 'Salma', '2': 'Ahmed', '3': 'Take your pills at 8' });

    expect(() =>
      whatsappContentVariables('checkin_daily', ['receiverName', 'senderDisplayName'], { receiverName: 'Salma' }),
    ).toThrow(MissingMessageVariableError);
    expect(() => whatsappContentVariables('checkin_daily', ['receiverName'], { receiverName: '   ' })).toThrow(
      'Message template checkin_daily requires variable "receiverName"',
    );
  });
});
