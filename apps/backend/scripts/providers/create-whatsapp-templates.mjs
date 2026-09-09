#!/usr/bin/env node
// Creates — or updates — every WhatsApp Content Template Nearby sends, through the Twilio Content API, submits
// each one for WhatsApp approval, and prints the `TWILIO_WHATSAPP_CONTENT_SIDS` value the backend boots with
// (CB-083). It replaces the hand work described in docs/providers/whatsapp.md §5: 112 texts pasted into the
// Content Template Builder and 112 SIDs copied back out.
//
//   node apps/backend/scripts/providers/create-whatsapp-templates.mjs --dry-run     plan only, no network at all
//   node apps/backend/scripts/providers/create-whatsapp-templates.mjs --self-test   whole flow, fake Content API
//   TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... \
//     node apps/backend/scripts/providers/create-whatsapp-templates.mjs             the real run
//
// Credentials come from the environment only, never from a flag (a flag lands in shell history) and never from a
// file. Exit 0 when every template is in the state this script intends, 1 when something needs a human, 2 on a
// usage error.
//
// What it sends, and where each part comes from:
//
//   text        the seed migration `202609060103_seed_channel_templates_8_languages` — the same rows the running
//               backend numbers its placeholders from — run through the provider's own numbering helper
//               (`whatsappTemplateText`, loaded from the compiled backend, never copied here), so the submitted
//               text and the text the provider numbers at send time cannot disagree.
//   variants    the plain variant of every key and language (64), plus the all-optional-sections variant of the
//               six keys that have one (48) = 112. `--all-variants` adds the single-section variants of the three
//               backup-contact alerts (48 more, 160 in total); docs/providers/whatsapp.md §3 explains when those
//               are worth having.
//   buttons     docs/providers/whatsapp.md §2. The button *id* is the English keyword the inbound reply parser
//               understands (`ButtonPayload` is read before `ButtonText`), so it must stay in capitals.
//   samples     one sample value per placeholder — Meta reviews them. The same fixtures the seed spec uses.
//   category    UTILITY. A check-in, a consent request and a safety alert are transactional (whatsapp.md §5).
//
// `account_step_up_otp` is deliberately absent: the step-up code goes to the sender over SMS, never WhatsApp.
//
// Idempotency. `friendly_name` is the natural key (`checkin_daily_personalnote_ar`, the name whatsapp.md §5 tells
// the founder to use), so a second run finds what the first one created and changes nothing. When the seed text
// has changed since the template was created the script PUTs the new text onto the same Content SID — but only
// while Twilio still allows an edit: a template already submitted for WhatsApp approval is frozen, so that case
// is reported for a human instead (a new name, a new SID, a new approval). This script never deletes anything.
//
// NOT VERIFIED AGAINST A LIVE ACCOUNT. There is no Twilio account yet. Every request shape here follows Twilio's
// published Content API contract and is exercised only against `create-whatsapp-templates.fake-content-api.mjs`;
// the first real run is the first time these requests meet Twilio. Run `--dry-run` first, then a single template
// (`--templates=consent_request --languages=en`), and only then the whole set.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..', '..');

/** The rows the backend renders from; `message-catalog.seed.spec.ts` fixes this file's format. */
export const SEED_MIGRATION = path.join(
  BACKEND_DIR,
  'prisma',
  'migrations',
  '202609060103_seed_channel_templates_8_languages',
  'migration.sql',
);

/** Compiled `src/modules/channels/whatsapp-content-variables.ts`; `npm run build` (repo root) produces it. */
export const NUMBERING_HELPER = path.join(BACKEND_DIR, 'dist', 'modules', 'channels', 'whatsapp-content-variables.js');

/** One row per line, dollar-quoted body — the format the seed migration header promises. */
const SEED_ROW_PATTERN = /^\s*\('([a-z_]+)', '([a-z]{2})', \$body\$(.*?)\$body\$, ARRAY\[([^\]]*)\]\),?\s*$/gm;

export const CONTENT_API_BASE_URL = 'https://content.twilio.com/v1';
export const APPROVAL_CATEGORY = 'UTILITY';
export const DEFAULT_TIMEOUT_MS = 15_000;
const LIST_PAGE_SIZE = 100;

/** The seed's two-letter codes, in seed order; also the `language` submitted to Twilio. */
export const LANGUAGES = ['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn'];

/**
 * Quick-reply buttons per template key (docs/providers/whatsapp.md §2), at most three, ids in capitals because
 * the webhook reads `ButtonPayload` before `ButtonText`. Every WhatsApp template Nearby sends is listed here;
 * `account_step_up_otp` is not one of them.
 */
export const QUICK_REPLY_BUTTONS = {
  consent_request: ['YES', 'STOP', 'REPORT'],
  checkin_daily: ['YES', 'HELP', 'STOP'],
  checkin_retry: ['YES', 'HELP', 'STOP'],
  receiver_checkins_paused: ['STOP', 'REPORT'],
  receiver_checkins_ended: ['REPORT'],
  backup_contact_missed_checkin_alert: ['DONE'],
  backup_contact_help_alert: ['DONE'],
  backup_contact_sender_requested_alert: ['DONE'],
};

export const TEMPLATE_KEYS = Object.keys(QUICK_REPLY_BUTTONS);

/**
 * Button titles. The title is what the receiver sees; the id is what the parser reads. They are the same Latin
 * keyword in every language on purpose: the body of every template tells the receiver to reply with that exact
 * word, the reply parser only understands the Latin keywords, and a title that says something else would teach a
 * different word from the sentence above it. A native reviewer who wants localised titles changes this table (one
 * entry per language) — the ids must not change.
 */
export const BUTTON_TITLES = { YES: 'YES', HELP: 'HELP', STOP: 'STOP', REPORT: 'REPORT', DONE: 'DONE' };

/** Sample values Meta reviews, one per placeholder. Same fixtures as `message-catalog.seed.spec.ts`. */
export const SAMPLE_VALUES = {
  receiverName: 'Fatima',
  senderDisplayName: 'Ahmed',
  personalNote: 'Take your pills at 8',
  contactName: 'Salma',
  channelsTried: 'WhatsApp and SMS',
  locationInstructions: 'Flat 12, blue door',
};

export class UsageError extends Error {}

/** A non-2xx answer from the Content API, carrying Twilio's own code and message. */
export class ContentApiError extends Error {
  constructor(status, message, code) {
    super(code ? `HTTP ${status} (Twilio ${code}): ${message}` : `HTTP ${status}: ${message}`);
    this.status = status;
    this.twilioCode = code;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    selfTest: false,
    json: false,
    allVariants: false,
    submit: true,
    languages: [...LANGUAGES],
    templateKeys: [...TEMPLATE_KEYS],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--all-variants') {
      options.allVariants = true;
    } else if (arg === '--no-submit') {
      options.submit = false;
    } else if (arg.startsWith('--languages=')) {
      options.languages = splitList(arg.slice('--languages='.length));
    } else if (arg.startsWith('--templates=')) {
      options.templateKeys = splitList(arg.slice('--templates='.length));
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }

  const unknownLanguages = options.languages.filter((language) => !LANGUAGES.includes(language));
  if (options.languages.length === 0 || unknownLanguages.length > 0) {
    throw new UsageError(`--languages must be a subset of ${LANGUAGES.join(',')}`);
  }
  const unknownKeys = options.templateKeys.filter((key) => !TEMPLATE_KEYS.includes(key));
  if (options.templateKeys.length === 0 || unknownKeys.length > 0) {
    throw new UsageError(`--templates must be a subset of ${TEMPLATE_KEYS.join(',')}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new UsageError('--timeout-ms must be a positive integer');
  }
  if (options.dryRun && options.selfTest) {
    throw new UsageError('--dry-run and --self-test are different modes; pass one');
  }
  return options;
}

function splitList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Credentials come from the environment, never from a flag. */
export function readCredentials(env) {
  const accountSid = (env.TWILIO_ACCOUNT_SID ?? '').trim();
  const authToken = (env.TWILIO_AUTH_TOKEN ?? '').trim();
  if (!accountSid || !authToken) {
    throw new UsageError(
      'set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in the environment (never as a command-line argument), ' +
        'or pass --dry-run to plan without them',
    );
  }
  return { accountSid, authToken };
}

// ---------------------------------------------------------------------------
// The plan: seed rows -> variants -> numbered Content Template payloads
// ---------------------------------------------------------------------------

/** `templateKey:language` -> the seeded body, with `{{name}}` placeholders and `{{#section}}` markers intact. */
export function readSeedRows(sql) {
  const rows = new Map();
  for (const match of sql.matchAll(SEED_ROW_PATTERN)) {
    rows.set(`${match[1]}:${match[2]}`, match[3] ?? '');
  }
  if (rows.size === 0) {
    throw new Error(`no seed rows found in ${SEED_MIGRATION}; the migration format changed`);
  }
  return rows;
}

/**
 * The provider's numbering helper, loaded from the compiled backend so this script cannot drift from what the
 * provider does at send time. It is the one thing here that needs a build.
 */
export function loadNumberingHelper(modulePath = NUMBERING_HELPER) {
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  try {
    return require(modulePath);
  } catch (error) {
    throw new UsageError(
      `could not load the numbering helper from ${path.relative(process.cwd(), modulePath)} (${error.message}). ` +
        "This script reuses the provider's own numbering code instead of copying it, so build the backend first: " +
        'npm ci && npm run prisma:generate && npm run build (from the repository root).',
    );
  }
}

/**
 * Which section sets get their own template: the plain one always, the all-sections one when there is at least
 * one section, and — with `--all-variants` — every subset in between, in the template's own section order.
 */
export function variantSectionSets(sections, allVariants = false) {
  if (sections.length === 0) {
    return [[]];
  }
  if (!allVariants || sections.length === 1) {
    return [[], [...sections]];
  }

  const subsets = [[]];
  for (const section of sections) {
    subsets.push(...subsets.map((subset) => [...subset, section]));
  }
  return subsets.sort((a, b) => a.length - b.length || sections.indexOf(a[0]) - sections.indexOf(b[0]));
}

/** `checkin_daily+personalNote` in `ar` -> `checkin_daily_personalnote_ar`, the name whatsapp.md §5 prescribes. */
export function approvalName(variant, language) {
  const name = `${variant.replace(/\+/g, '_')}_${language}`.toLowerCase();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new Error(`template name "${name}" is not lowercase alphanumeric and underscores, which Meta requires`);
  }
  return name;
}

function sampleVariables(templateKey, placeholders) {
  const variables = {};
  placeholders.forEach((placeholder, index) => {
    const sample = SAMPLE_VALUES[placeholder];
    if (!sample) {
      throw new Error(`no sample value for {{${placeholder}}} of ${templateKey}; add one to SAMPLE_VALUES`);
    }
    variables[String(index + 1)] = sample;
  });
  return variables;
}

/** Every template to create, in a stable order: template key, then language, then variant. */
export function planTemplates({
  seedRows,
  helper,
  languages = LANGUAGES,
  templateKeys = TEMPLATE_KEYS,
  allVariants = false,
}) {
  const plans = [];
  for (const templateKey of templateKeys) {
    for (const language of languages) {
      const bodyText = seedRows.get(`${templateKey}:${language}`);
      if (bodyText === undefined) {
        throw new Error(`the seed migration has no ${templateKey}:${language} row`);
      }

      for (const keep of variantSectionSets(helper.optionalSectionsOf(bodyText), allVariants)) {
        const variant = helper.whatsappVariantKey(templateKey, keep);
        const { text, placeholders } = helper.whatsappTemplateText(bodyText, keep);
        plans.push({
          templateKey,
          language,
          variant,
          sections: keep,
          sidKey: `${variant}:${language}`,
          name: approvalName(variant, language),
          text,
          placeholders,
          buttons: QUICK_REPLY_BUTTONS[templateKey] ?? [],
          variables: sampleVariables(templateKey, placeholders),
        });
      }
    }
  }

  const names = new Set();
  for (const plan of plans) {
    if (names.has(plan.name)) {
      throw new Error(`two templates would be named ${plan.name}; names are the idempotency key and must be unique`);
    }
    names.add(plan.name);
  }
  return plans;
}

/** The Content API create/update body. Quick-reply when the template has buttons, plain text when it does not. */
export function contentPayload(plan) {
  const types =
    plan.buttons.length > 0
      ? {
          'twilio/quick-reply': {
            body: plan.text,
            actions: plan.buttons.map((id) => ({ title: BUTTON_TITLES[id] ?? id, id })),
          },
        }
      : { 'twilio/text': { body: plan.text } };

  return { friendly_name: plan.name, language: plan.language, variables: plan.variables, types };
}

/**
 * True when the template on the account already says exactly what this run would say. Only the fields this script
 * sets are compared — language, sample values, body, button titles and ids — because Twilio is free to echo a
 * resource back with fields of its own, and a whole-object comparison would read that as drift and rewrite all 112.
 */
export function contentMatches(existing, payload) {
  if (existing?.language !== payload.language) {
    return false;
  }

  const wantedVariables = Object.entries(payload.variables ?? {});
  const foundVariables = existing?.variables ?? {};
  if (
    wantedVariables.length !== Object.keys(foundVariables).length ||
    !wantedVariables.every(([index, value]) => foundVariables[index] === value)
  ) {
    return false;
  }

  const [contentType, wanted] = Object.entries(payload.types)[0];
  const found = existing?.types?.[contentType];
  if (!found || found.body !== wanted.body) {
    return false;
  }

  const wantedActions = wanted.actions ?? [];
  const foundActions = Array.isArray(found.actions) ? found.actions : [];
  return (
    wantedActions.length === foundActions.length &&
    wantedActions.every(
      (action, index) => foundActions[index]?.id === action.id && foundActions[index]?.title === action.title,
    )
  );
}

/** `undefined` when the template was never submitted to Meta; otherwise Twilio's lower-cased status. */
export function approvalStatusOf(existing) {
  const status = existing?.approval_requests?.status;
  return typeof status === 'string' ? status.toLowerCase() : undefined;
}

function isFrozenByApproval(existing) {
  const status = approvalStatusOf(existing);
  return status !== undefined && status !== 'unsubmitted';
}

// ---------------------------------------------------------------------------
// Twilio Content API
// ---------------------------------------------------------------------------

export function createTwilioContentApi({
  accountSid,
  authToken,
  fetchImpl = fetch,
  baseUrl = CONTENT_API_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  async function request(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ContentApiError(
        response.status,
        payload?.message ?? response.statusText ?? 'request failed',
        payload?.code,
      );
    }
    return payload ?? {};
  }

  return {
    /** Every template on the account with its approval status, following `meta.next_page_url`. */
    async listContents() {
      const contents = [];
      let url = `${baseUrl}/ContentAndApprovals?PageSize=${LIST_PAGE_SIZE}`;
      for (let page = 0; url && page < 200; page += 1) {
        const payload = await request('GET', url);
        contents.push(...(Array.isArray(payload.contents) ? payload.contents : []));
        url = typeof payload?.meta?.next_page_url === 'string' ? payload.meta.next_page_url : undefined;
      }
      return contents;
    },
    createContent(payload) {
      return request('POST', `${baseUrl}/Content`, payload);
    },
    updateContent(sid, payload) {
      return request('PUT', `${baseUrl}/Content/${sid}`, payload);
    },
    /**
     * Twilio's OpenAPI spec spells this path `/ApprovalRequests/whatsapp` and the documentation page spells it
     * `/ApprovalRequests/WhatsApp`; nobody here has called it for real, so try the spec's casing and fall back.
     */
    async submitForApproval(sid, name) {
      const body = { name, category: APPROVAL_CATEGORY };
      try {
        return await request('POST', `${baseUrl}/Content/${sid}/ApprovalRequests/whatsapp`, body);
      } catch (error) {
        if (error instanceof ContentApiError && error.status === 404) {
          return request('POST', `${baseUrl}/Content/${sid}/ApprovalRequests/WhatsApp`, body);
        }
        throw error;
      }
    },
  };
}

function sidOf(content, name) {
  const sid = content?.sid;
  if (typeof sid !== 'string' || sid.length === 0) {
    throw new Error(`the Content API answered without a sid for ${name}`);
  }
  return sid;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Walks the plan against the account: create what is missing, update what changed and can still be edited, leave
 * what already matches, submit anything Meta has not seen. One template at a time — 112 requests in a burst is a
 * good way to meet Twilio's rate limiter, and a watched script that prints a line per template is easier to trust.
 */
export async function createWhatsappTemplates({ api, plans, submit = true, onResult = () => {} }) {
  const existing = new Map();
  for (const content of await api.listContents()) {
    if (typeof content?.friendly_name === 'string') {
      existing.set(content.friendly_name, content);
    }
  }

  const results = [];
  const sidMap = {};
  for (const plan of plans) {
    const result = { sidKey: plan.sidKey, name: plan.name, action: 'unchanged', sid: undefined, submitted: false };
    try {
      const payload = contentPayload(plan);
      const found = existing.get(plan.name);

      if (!found) {
        result.sid = sidOf(await api.createContent(payload), plan.name);
        result.action = 'created';
      } else {
        result.sid = sidOf(found, plan.name);
        if (contentMatches(found, payload)) {
          result.action = 'unchanged';
        } else if (isFrozenByApproval(found)) {
          result.action = 'frozen';
          result.problem =
            `the template was already submitted to Meta (${approvalStatusOf(found)}) and its text no longer ` +
            'matches the seed row; Twilio cannot edit a submitted template, so create a new one under a new name ' +
            'and move this key onto the new SID';
        } else {
          await api.updateContent(result.sid, payload);
          result.action = 'updated';
        }
      }

      // Recorded before the approval request: a template that exists keeps its place in the map even if
      // submitting it fails, so a retry re-submits rather than creating a second copy.
      sidMap[plan.sidKey] = result.sid;

      const status = approvalStatusOf(found);
      if (submit && result.action !== 'frozen') {
        if (
          result.action === 'created' ||
          result.action === 'updated' ||
          status === undefined ||
          status === 'unsubmitted'
        ) {
          await api.submitForApproval(result.sid, plan.name);
          result.submitted = true;
        } else if (status === 'rejected') {
          const reason = found?.approval_requests?.rejection_reason;
          result.problem = `Meta rejected this template${reason ? ` (${reason})` : ''}; fix the copy by migration, then re-run`;
        }
      }
    } catch (error) {
      result.action = 'failed';
      result.problem = error.message;
    }

    results.push(result);
    onResult(result);
  }

  return { results, sidMap };
}

export function summarise(results) {
  const counts = { created: 0, updated: 0, unchanged: 0, frozen: 0, failed: 0, submitted: 0 };
  for (const result of results) {
    counts[result.action] = (counts[result.action] ?? 0) + 1;
    if (result.submitted) {
      counts.submitted += 1;
    }
  }
  return counts;
}

/** The one line to paste into the backend environment (docs/providers/whatsapp.md §4). */
export function envVarLine(sidMap) {
  return `TWILIO_WHATSAPP_CONTENT_SIDS='${JSON.stringify(sidMap)}'`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function buildPlans(options) {
  const seedRows = readSeedRows(readFileSync(SEED_MIGRATION, 'utf8'));
  const helper = loadNumberingHelper();
  return planTemplates({
    seedRows,
    helper,
    languages: options.languages,
    templateKeys: options.templateKeys,
    allVariants: options.allVariants,
  });
}

async function main(argv, env) {
  const options = parseArgs(argv);

  if (options.selfTest) {
    const { runSelfTest } = await import('./create-whatsapp-templates.self-test.mjs');
    return runSelfTest(options);
  }

  // Credentials first: a missing one should not cost a build-and-plan (and a real run must never start half-done).
  const credentials = options.dryRun ? undefined : readCredentials(env);
  const plans = buildPlans(options);

  if (options.dryRun) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ templates: plans }, null, 2)}\n`);
      return 0;
    }
    console.log(`create-whatsapp-templates --dry-run: ${plans.length} templates, no request will be made`);
    for (const plan of plans) {
      console.log(
        `  ${plan.name.padEnd(56)} ${String(plan.placeholders.length)} vars  ` +
          `${plan.buttons.join('/') || 'no buttons'}  ${plan.text.length} chars`,
      );
    }
    console.log(`\n${plans.length} templates planned; nothing was sent. Drop --dry-run to create them.`);
    return 0;
  }

  const api = createTwilioContentApi({ ...credentials, timeoutMs: options.timeoutMs });
  if (!options.json) {
    // Nothing read from the environment is printed, not even a prefix of the account SID: this output is pasted
    // into issues and chat logs, and CodeQL is right to call an environment value in a log line clear-text logging.
    console.log(`create-whatsapp-templates: ${plans.length} templates on the account TWILIO_ACCOUNT_SID names`);
  }

  const { results, sidMap } = await createWhatsappTemplates({
    api,
    plans,
    submit: options.submit,
    onResult: (result) => {
      if (options.json) {
        return;
      }
      const suffix = result.submitted ? ' (submitted for approval)' : '';
      console.log(`  ${result.action.padEnd(9)} ${result.sidKey.padEnd(64)} ${result.sid ?? '-'}${suffix}`);
      if (result.problem) {
        console.log(`            ${result.problem}`);
      }
    },
  });

  const counts = summarise(results);
  const needAttention = results.filter((result) => result.problem);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(sidMap)}\n`);
  } else {
    console.log(
      `\n${results.length} templates: ${counts.created} created, ${counts.updated} updated, ` +
        `${counts.unchanged} unchanged, ${counts.frozen} frozen, ${counts.failed} failed; ` +
        `${counts.submitted} submitted for WhatsApp approval.`,
    );
    console.log(
      '\nPaste into the backend environment and restart it (approval can take up to 24 hours; a template that ' +
        'is not approved yet still has its SID here):\n',
    );
    console.log(envVarLine(sidMap));
  }

  for (const result of needAttention) {
    console.error(`${result.sidKey}: ${result.problem}`);
  }
  return needAttention.length > 0 ? 1 : 0;
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisFile = fileURLToPath(import.meta.url);
const invokedDirectly =
  process.platform === 'win32' ? entryPoint.toLowerCase() === thisFile.toLowerCase() : entryPoint === thisFile;
if (invokedDirectly) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      if (error instanceof UsageError) {
        console.error(`create-whatsapp-templates: ${error.message}`);
        console.error(
          'usage: node scripts/providers/create-whatsapp-templates.mjs [--dry-run] [--self-test] [--json] ' +
            '[--all-variants] [--no-submit] [--languages=en,ar,...] [--templates=checkin_daily,...] ' +
            '[--timeout-ms=15000]',
        );
        process.exitCode = 2;
        return;
      }
      console.error(`create-whatsapp-templates failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

export { main };
