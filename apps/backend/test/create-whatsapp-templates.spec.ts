import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Channel } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryChannelTemplateRepository } from '../src/modules/channels/channel-template.repository';
import { MessageCatalogService } from '../src/modules/channels/message-catalog.service';
import {
  optionalSectionsOf,
  whatsappTemplateText,
  whatsappVariantKey,
} from '../src/modules/channels/whatsapp-content-variables';
import { WhatsappProvider } from '../src/modules/channels/whatsapp.provider';
import { parseTwilioWhatsappContentSids } from '../src/shared/config/app-config.service';

/**
 * `scripts/providers/create-whatsapp-templates.mjs` (CB-083) run as the founder will run it, in three modes:
 * `--dry-run` (no network, no credentials), `--self-test` (the whole create/update/submit flow against the fake
 * Content API in `create-whatsapp-templates.fake-content-api.mjs`), and with no arguments at all.
 *
 * The script has never been run against a real Twilio account — none exists. What this spec adds to the script's
 * own self-test is the half the script cannot check about itself: that the text it would submit is the text the
 * provider numbers at send time, that the `TWILIO_WHATSAPP_CONTENT_SIDS` it prints is accepted by the real boot
 * parser, and that a `WhatsappProvider` configured with it finds a Content SID for every template, language and
 * variant it can ask for.
 */
const SCRIPT = resolve(__dirname, '../scripts/providers/create-whatsapp-templates.mjs');
const SEED_MIGRATION = resolve(
  __dirname,
  '../prisma/migrations/202609060103_seed_channel_templates_8_languages/migration.sql',
);
const SEED_ROW_PATTERN = /^\s*\('([a-z_]+)', '([a-z]{2})', \$body\$(.*?)\$body\$, ARRAY\[([^\]]*)\]\),?\s*$/gm;
const EXPECTED_TEMPLATE_COUNT = 112;

interface PlannedTemplate {
  templateKey: string;
  language: string;
  variant: string;
  sections: string[];
  sidKey: string;
  name: string;
  text: string;
  placeholders: string[];
  buttons: string[];
  variables: Record<string, string>;
}

interface SeedRow {
  templateKey: string;
  language: string;
  bodyText: string;
}

function readSeedRows(): SeedRow[] {
  const sql = readFileSync(SEED_MIGRATION, 'utf8');
  return [...sql.matchAll(SEED_ROW_PATTERN)].map((match) => ({
    templateKey: match[1] ?? '',
    language: match[2] ?? '',
    bodyText: match[3] ?? '',
  }));
}

/** Runs the script with no Twilio credentials in the environment, so a stray network call could not authenticate. */
function runScript(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.TWILIO_ACCOUNT_SID;
  delete env.TWILIO_AUTH_TOKEN;

  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 120_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

class RecordingTwilioHttpClient {
  public requests: Array<{ url: string; body: URLSearchParams }> = [];

  async postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
    this.requests.push({ url, body });
    return { sid: 'SM123', status: 'queued' };
  }
}

function whatsappProvider(contentSidByTemplateKey: Record<string, string>, httpClient: RecordingTwilioHttpClient) {
  const catalog = new MessageCatalogService(
    new InMemoryChannelTemplateRepository(
      readSeedRows().map((row) => ({ ...row, channel: Channel.WHATSAPP, active: true })),
    ),
  );

  return new WhatsappProvider(
    {
      accountSid: 'AC123',
      authToken: 'twilio-auth-token',
      fromNumber: '+15550002222',
      contentSidByTemplateKey,
    },
    httpClient,
    () => new Date('2026-09-09T09:00:00.000Z'),
    catalog,
  );
}

/** The named variables a receiver-facing send would carry, taken from the sample values the script submits. */
function namedVariables(template: PlannedTemplate): Record<string, string> {
  return Object.fromEntries(
    template.placeholders.map((placeholder, index) => [placeholder, template.variables[String(index + 1)] ?? '']),
  );
}

describe('create-whatsapp-templates.mjs (CB-083)', () => {
  let plan: PlannedTemplate[] = [];
  let sidMapJson = '';
  let sidMap: Record<string, string> = {};
  let selfTestOutput = '';

  beforeAll(() => {
    const dryRun = runScript(['--dry-run', '--json']);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    plan = (JSON.parse(dryRun.stdout) as { templates: PlannedTemplate[] }).templates;

    const selfTest = runScript(['--self-test', '--json']);
    expect(selfTest.status, selfTest.stderr).toBe(0);
    selfTestOutput = selfTest.stderr;
    sidMapJson = selfTest.stdout;
    sidMap = JSON.parse(sidMapJson) as Record<string, string>;
  }, 180_000);

  it('passes its own self-test against the fake Content API', () => {
    expect(selfTestOutput).toMatch(/# \d+ assertions passed against the fake Content API/);
    expect(selfTestOutput).toContain('nothing was sent to Twilio');
  });

  it('plans the 112 templates of docs/providers/whatsapp.md with no credentials and no network', () => {
    expect(plan).toHaveLength(EXPECTED_TEMPLATE_COUNT);
    expect(new Set(plan.map((template) => template.name)).size).toBe(EXPECTED_TEMPLATE_COUNT);
    expect(new Set(plan.map((template) => template.language))).toEqual(
      new Set(['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn']),
    );
    // The step-up code is an SMS to the sender, never a WhatsApp template.
    expect(plan.some((template) => template.templateKey === 'account_step_up_otp')).toBe(false);
  });

  it('numbers every template with the provider’s own helper, from the seeded rows', () => {
    const seedByKey = new Map(readSeedRows().map((row) => [`${row.templateKey}:${row.language}`, row.bodyText]));

    for (const template of plan) {
      const bodyText = seedByKey.get(`${template.templateKey}:${template.language}`);
      expect(bodyText, template.sidKey).toBeDefined();

      const numbered = whatsappTemplateText(bodyText ?? '', template.sections);
      expect(numbered.text, template.sidKey).toBe(template.text);
      expect(numbered.placeholders, template.sidKey).toEqual(template.placeholders);
      expect(template.sidKey).toBe(
        `${whatsappVariantKey(template.templateKey, template.sections)}:${template.language}`,
      );
      expect(template.name).toBe(`${template.variant.replace(/\+/g, '_')}_${template.language}`.toLowerCase());
    }
  });

  it('plans the plain variant and the all-sections variant of every seeded WhatsApp row', () => {
    const planned = new Set(plan.map((template) => template.sidKey));

    for (const row of readSeedRows()) {
      if (row.templateKey === 'account_step_up_otp') {
        continue;
      }
      const sections = optionalSectionsOf(row.bodyText);
      expect(planned, `${row.templateKey}:${row.language}`).toContain(`${row.templateKey}:${row.language}`);
      if (sections.length > 0) {
        expect(planned).toContain(`${whatsappVariantKey(row.templateKey, sections)}:${row.language}`);
      }
    }
  });

  it('prints a TWILIO_WHATSAPP_CONTENT_SIDS the backend accepts at boot', () => {
    const parsed = parseTwilioWhatsappContentSids(sidMapJson);

    expect(parsed).toBeDefined();
    expect(Object.keys(parsed ?? {})).toHaveLength(EXPECTED_TEMPLATE_COUNT);
    expect(Object.keys(parsed ?? {}).sort()).toEqual(plan.map((template) => template.sidKey).sort());
    for (const [key, sid] of Object.entries(parsed ?? {})) {
      expect(sid, key).toMatch(/^HX[0-9a-f]{32}$/);
    }
  });

  it('emits a Content SID the provider finds for every template, language and variant it plans', async () => {
    for (const template of plan) {
      const httpClient = new RecordingTwilioHttpClient();
      const provider = whatsappProvider(sidMap, httpClient);

      const result = await provider.sendMessage('+971501234567', {
        templateKey: template.templateKey,
        language: template.language,
        variables: namedVariables(template),
      });

      const body = httpClient.requests[0]?.body;
      expect(body?.get('ContentSid'), template.sidKey).toBe(sidMap[template.sidKey]);
      // The numbering the script submitted is the numbering the provider sends.
      expect(JSON.parse(body?.get('ContentVariables') ?? '{}'), template.sidKey).toEqual(template.variables);
      expect(result.rendering, template.sidKey).toEqual({ language: template.language, fallback: false });
    }
  });

  it('falls back to the English template for a language nobody approved, as the map allows', async () => {
    const httpClient = new RecordingTwilioHttpClient();
    const provider = whatsappProvider(sidMap, httpClient);

    const result = await provider.sendMessage('+971501234567', {
      templateKey: 'checkin_daily',
      language: 'fr',
      variables: { receiverName: 'Fatima', senderDisplayName: 'Ahmed' },
    });

    expect(httpClient.requests[0]?.body.get('ContentSid')).toBe(sidMap['checkin_daily:en']);
    expect(result.rendering).toEqual({ language: 'en', fallback: true });
  });

  it('drops an optional value the emitted map has no variant for, rather than sending it empty', async () => {
    const httpClient = new RecordingTwilioHttpClient();
    const provider = whatsappProvider(sidMap, httpClient);

    // Only one of the two optional sections is known, and the default run approves no single-section variant.
    await provider.sendMessage('+971501234567', {
      templateKey: 'backup_contact_missed_checkin_alert',
      language: 'en',
      variables: {
        contactName: 'Salma',
        receiverName: 'Fatima',
        senderDisplayName: 'Ahmed',
        channelsTried: 'WhatsApp and SMS',
      },
    });

    const body = httpClient.requests[0]?.body;
    expect(body?.get('ContentSid')).toBe(sidMap['backup_contact_missed_checkin_alert:en']);
    expect(JSON.parse(body?.get('ContentVariables') ?? '{}')).toEqual({ 1: 'Salma', 2: 'Fatima', 3: 'Ahmed' });
  });

  it('refuses to touch Twilio when the credentials are not in the environment', () => {
    const result = runScript([]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    expect(result.stdout).toBe('');
  });

  it('rejects an unknown argument instead of guessing', () => {
    const result = runScript(['--languages=klingon']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--languages must be a subset of');
  });
});
