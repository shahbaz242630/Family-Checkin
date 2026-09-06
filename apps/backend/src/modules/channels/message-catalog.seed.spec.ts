import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { InMemoryChannelTemplateRepository } from './channel-template.repository';
import { MessageCatalogService } from './message-catalog.service';
import {
  IN_CODE_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_KEYS,
  NEUTRAL_SENDER_DISPLAY_NAME,
  NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS,
  NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE,
} from './message-catalog.templates';

/**
 * The seed migration is the single source of truth for the eight-language copy, so this spec reads the SQL the
 * database will run rather than a TypeScript mirror of it. One `VALUES` row per line, dollar-quoted body, then the
 * `variables` array; the format is fixed by the migration header comment.
 */
const SEED_MIGRATION = resolve(
  __dirname,
  '../../../prisma/migrations/202609060103_seed_channel_templates_8_languages/migration.sql',
);
const SEED_LANGUAGES = ['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn'] as const;
const REPLY_KEYWORDS = ['YES', 'HELP', 'STOP', 'REPORT', 'DONE'] as const;
const MAX_BODY_LENGTH = 320;
const SEED_ROW_PATTERN = /^\s*\('([a-z_]+)', '([a-z]{2})', \$body\$(.*?)\$body\$, ARRAY\[([^\]]*)\]\),?\s*$/gm;

interface SeedRow {
  templateKey: string;
  language: string;
  bodyText: string;
  variables: string[];
}

function readSeedRows(): { sql: string; rows: SeedRow[] } {
  const sql = readFileSync(SEED_MIGRATION, 'utf8');
  const rows: SeedRow[] = [];
  for (const match of sql.matchAll(SEED_ROW_PATTERN)) {
    rows.push({
      templateKey: match[1] ?? '',
      language: match[2] ?? '',
      bodyText: match[3] ?? '',
      variables: (match[4] ?? '')
        .split(',')
        .map((name) => name.trim().replace(/^'|'$/g, ''))
        .filter((name) => name.length > 0)
        .sort(),
    });
  }
  return { sql, rows };
}

function placeholders(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map((match) => match[1] ?? '').sort();
}

function sections(body: string): string[] {
  return [...body.matchAll(/\{\{#([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1] ?? '').sort();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const allVariables = {
  receiverName: 'Fatima',
  senderDisplayName: 'Ahmed',
  personalNote: 'Take your pills at 8',
  contactName: 'Salma',
  channelsTried: 'WhatsApp and SMS',
  locationInstructions: 'Flat 12, blue door',
  code: '123456',
  validityMinutes: '10',
};

describe('channel_templates seed migration (CB-010, eight BRD languages)', () => {
  const { sql, rows } = readSeedRows();
  const englishByKey = new Map(MESSAGE_TEMPLATE_KEYS.map((key) => [key, IN_CODE_MESSAGE_TEMPLATES[key].en ?? '']));

  it('seeds every in-code template key in every launch language, for SMS and WhatsApp, idempotently', () => {
    const pairs = rows.map((row) => `${row.templateKey}:${row.language}`);

    expect(rows.length).toBe(MESSAGE_TEMPLATE_KEYS.length * SEED_LANGUAGES.length);
    expect(unique(pairs).length).toBe(rows.length);
    for (const templateKey of MESSAGE_TEMPLATE_KEYS) {
      for (const language of SEED_LANGUAGES) {
        expect(pairs, `${templateKey}:${language}`).toContain(`${templateKey}:${language}`);
      }
    }
    expect(sql).toContain(`CROSS JOIN (VALUES ('SMS'), ('WHATSAPP'))`);
    expect(sql).toContain(`ON CONFLICT ("templateKey", "language", "channel") DO NOTHING`);
    expect(sql).not.toMatch(/'VOICE'/);
  });

  it('seeds the English rows with exactly the in-code English copy', () => {
    for (const row of rows.filter((candidate) => candidate.language === 'en')) {
      expect(row.bodyText, row.templateKey).toBe(
        englishByKey.get(row.templateKey as (typeof MESSAGE_TEMPLATE_KEYS)[number]),
      );
    }
  });

  it('keeps every placeholder, optional section and Latin reply keyword of the English source', () => {
    for (const row of rows) {
      const english = englishByKey.get(row.templateKey as (typeof MESSAGE_TEMPLATE_KEYS)[number]) ?? '';
      const label = `${row.templateKey}:${row.language}`;

      expect(row.bodyText, `${label} emoji`).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(row.bodyText, `${label} whitespace`).toBe(row.bodyText.trim());
      expect(unique(placeholders(row.bodyText)), `${label} placeholders`).toEqual(unique(placeholders(english)));
      expect(sections(row.bodyText), `${label} sections`).toEqual(sections(english));
      expect(row.variables, `${label} variables column`).toEqual(unique(placeholders(english)));
      for (const keyword of REPLY_KEYWORDS) {
        if (english.includes(keyword)) {
          expect(row.bodyText, `${label} keyword ${keyword}`).toContain(keyword);
        }
      }
    }
  });

  it('renders every seeded row in its own language, fully resolved and within SMS-friendly length', async () => {
    const templates = new InMemoryChannelTemplateRepository(
      rows.map((row) => ({ ...row, channel: Channel.SMS, active: true })),
    );
    const catalog = new MessageCatalogService(templates);

    for (const row of rows) {
      const rendered = await catalog.render({
        templateKey: row.templateKey,
        language: row.language,
        channel: Channel.SMS,
        variables: allVariables,
      });

      expect(rendered.language, `${row.templateKey}:${row.language}`).toBe(row.language);
      expect(rendered.fallback, `${row.templateKey}:${row.language}`).toBe(false);
      expect(rendered.body, `${row.templateKey}:${row.language}`).not.toMatch(/\{\{|\}\}/);
      // Measured on the body that is actually sent, with every optional section present; the raw template
      // carries ~50 characters of section markup that never reaches a phone.
      expect(rendered.body.length, `${row.templateKey}:${row.language} length`).toBeLessThanOrEqual(MAX_BODY_LENGTH);
      for (const name of unique(placeholders(row.bodyText))) {
        const value = allVariables[name as keyof typeof allVariables];
        expect(value, `${row.templateKey}:${row.language} unknown variable ${name}`).toBeDefined();
        expect(rendered.body, `${row.templateKey}:${row.language} value of ${name}`).toContain(value);
      }
    }
  });

  it('renders every seeded row for a sender without a name in that language, never with the English fallback (CB-079)', async () => {
    const templates = new InMemoryChannelTemplateRepository(
      rows.map((row) => ({ ...row, channel: Channel.SMS, active: true })),
    );
    const catalog = new MessageCatalogService(templates);

    for (const row of rows.filter((candidate) => candidate.bodyText.includes('{{senderDisplayName}}'))) {
      const forBackupContact = row.templateKey.startsWith('backup_contact_');
      const rendered = await catalog.render({
        templateKey: row.templateKey,
        language: row.language,
        channel: Channel.SMS,
        variables: {
          ...allVariables,
          senderDisplayName: forBackupContact
            ? NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS
            : NEUTRAL_SENDER_DISPLAY_NAME,
        },
      });
      const phrases = NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE[row.language];
      const label = `${row.templateKey}:${row.language}`;

      expect(rendered.language, label).toBe(row.language);
      expect(rendered.body, label).toContain(forBackupContact ? phrases?.backupContact : phrases?.receiver);
      if (row.language !== 'en') {
        expect(rendered.body, label).not.toMatch(/family member/i);
      }
      expect(rendered.body.length, `${label} length with the neutral phrase`).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    }
  });

  it('renders the seeded Arabic checkin_daily as Arabic text carrying the personal note and the reply keywords', async () => {
    const templates = new InMemoryChannelTemplateRepository(
      rows.map((row) => ({ ...row, channel: Channel.SMS, active: true })),
    );
    const catalog = new MessageCatalogService(templates);

    const withNote = await catalog.render({
      templateKey: 'checkin_daily',
      language: 'ar',
      channel: Channel.SMS,
      variables: { receiverName: 'فاطمة', senderDisplayName: 'أحمد', personalNote: 'خذي الدواء في الثامنة' },
    });

    expect(withNote.language).toBe('ar');
    expect(withNote.fallback).toBe(false);
    expect(withNote.body).toMatch(/\p{Script=Arabic}/u);
    expect(withNote.body).toContain('فاطمة');
    expect(withNote.body).toContain('أحمد');
    expect(withNote.body).toContain('خذي الدواء في الثامنة');
    expect(withNote.body).not.toContain('{{');
    expect(withNote.body).not.toContain('}}');
    expect(withNote.body).not.toMatch(/Hi |checking in on you/);
    for (const keyword of ['YES', 'HELP', 'STOP', 'REPORT']) {
      expect(withNote.body).toContain(keyword);
    }

    const withoutNote = await catalog.render({
      templateKey: 'checkin_daily',
      language: 'ar',
      channel: Channel.SMS,
      variables: { receiverName: 'فاطمة', senderDisplayName: 'أحمد' },
    });

    expect(withoutNote.body).not.toContain('{{');
    expect(withoutNote.body).not.toContain('"');
    expect(withoutNote.body.length).toBeLessThan(withNote.body.length);
  });
});
