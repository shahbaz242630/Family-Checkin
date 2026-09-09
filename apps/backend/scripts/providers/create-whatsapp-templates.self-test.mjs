// The self-test behind `create-whatsapp-templates.mjs --self-test`: the whole flow, twice, against the fake
// Content API in `create-whatsapp-templates.fake-content-api.mjs`. No network, no credentials, no Twilio account.
//
// What it proves: the plan is the 112 templates docs/providers/whatsapp.md describes with the numbering the
// provider will use; each request satisfies the Content API's documented contract; a second run recognises what
// the first one created and changes nothing (same SIDs, no duplicates); changed copy is PUT onto the same SID
// while Twilio still allows an edit and reported for a human once Meta has seen it; one failed request costs one
// template, not the run; and the emitted map is valid JSON keyed the way the provider looks templates up.
//
// What it does not prove: that Twilio accepts any of this. The payloads have never met the real API (CB-083).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeContentApi } from './create-whatsapp-templates.fake-content-api.mjs';
import {
  createTwilioContentApi,
  createWhatsappTemplates,
  envVarLine,
  LANGUAGES,
  loadNumberingHelper,
  planTemplates,
  readSeedRows,
  SEED_MIGRATION,
  summarise,
  TEMPLATE_KEYS,
} from './create-whatsapp-templates.mjs';

const ACCOUNT_SID = 'AC123';
const AUTH_TOKEN = 'twilio-auth-token';
const EXPECTED_TEMPLATE_COUNT = 112;
const EXPECTED_TEMPLATE_COUNT_ALL_VARIANTS = 160;
const BUTTON_IDS = ['YES', 'HELP', 'STOP', 'REPORT', 'DONE'];

let checks = 0;

function check(description, assertion) {
  assertion();
  checks += 1;
  process.stderr.write(`ok ${checks} - ${description}\n`);
}

function apiFor(fake) {
  return createTwilioContentApi({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    fetchImpl: fake.fetchImpl,
  });
}

export async function runSelfTest(options = {}) {
  const seedRows = readSeedRows(readFileSync(SEED_MIGRATION, 'utf8'));
  const helper = loadNumberingHelper();
  const plans = planTemplates({ seedRows, helper });

  // ---------------------------------------------------------------- the plan
  check(
    `plans ${EXPECTED_TEMPLATE_COUNT} templates: ${TEMPLATE_KEYS.length} keys x ${LANGUAGES.length} languages, plus the all-sections variants`,
    () => {
      assert.equal(plans.length, EXPECTED_TEMPLATE_COUNT);
      assert.equal(new Set(plans.map((plan) => plan.sidKey)).size, EXPECTED_TEMPLATE_COUNT);
      assert.equal(new Set(plans.map((plan) => plan.name)).size, EXPECTED_TEMPLATE_COUNT);
    },
  );

  check(`--all-variants plans ${EXPECTED_TEMPLATE_COUNT_ALL_VARIANTS}, the single-section variants included`, () => {
    const all = planTemplates({ seedRows, helper, allVariants: true });
    assert.equal(all.length, EXPECTED_TEMPLATE_COUNT_ALL_VARIANTS);
    assert.ok(all.some((plan) => plan.sidKey === 'backup_contact_help_alert+channelsTried:ur'));
    assert.ok(all.some((plan) => plan.sidKey === 'backup_contact_help_alert+locationInstructions:ur'));
  });

  check('numbers every placeholder positionally, 1..n with no gaps and no named placeholder left', () => {
    for (const plan of plans) {
      const used = [...plan.text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      assert.equal(/\{\{\s*[A-Za-z]/.test(plan.text), false, `${plan.sidKey} still carries a named placeholder`);
      assert.deepEqual(
        [...new Set(used)],
        plan.placeholders.map((_placeholder, index) => index + 1),
        `${plan.sidKey} numbering`,
      );
      assert.deepEqual(Object.keys(plan.variables), [...new Set(used)].map(String), `${plan.sidKey} samples`);
    }
  });

  check(
    'keeps the Latin reply keywords and gives every template at most three buttons with parser-readable ids',
    () => {
      for (const plan of plans) {
        assert.ok(plan.buttons.length > 0 && plan.buttons.length <= 3, `${plan.sidKey} buttons`);
        for (const id of plan.buttons) {
          assert.ok(BUTTON_IDS.includes(id), `${plan.sidKey} button ${id}`);
          assert.ok(plan.text.includes(id), `${plan.sidKey} body does not mention ${id}`);
        }
      }
    },
  );

  check('carries the personal note as {{3}} in the +personalNote variant, as the provider will number it', () => {
    const plan = plans.find((candidate) => candidate.sidKey === 'checkin_daily+personalNote:en');
    assert.deepEqual(plan.placeholders, ['receiverName', 'senderDisplayName', 'personalNote']);
    assert.ok(plan.text.includes('"{{3}}"'));
    assert.equal(plan.name, 'checkin_daily_personalnote_en');
  });

  // ------------------------------------------------------------- first run
  const fake = createFakeContentApi({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, pageSize: 50 });
  const first = await createWhatsappTemplates({ api: apiFor(fake), plans });
  const firstCounts = summarise(first.results);

  check(`creates all ${EXPECTED_TEMPLATE_COUNT} templates on an empty account and submits each for approval`, () => {
    assert.deepEqual(firstCounts, {
      created: EXPECTED_TEMPLATE_COUNT,
      updated: 0,
      unchanged: 0,
      frozen: 0,
      failed: 0,
      submitted: EXPECTED_TEMPLATE_COUNT,
    });
    assert.equal(fake.contents.size, EXPECTED_TEMPLATE_COUNT);
    assert.equal(first.results.filter((result) => result.problem).length, 0);
  });

  check('submits every template as a UTILITY WhatsApp template under its own name', () => {
    for (const content of fake.contents.values()) {
      assert.equal(content.approval_requests?.category, 'UTILITY', content.friendly_name);
      assert.equal(content.approval_requests?.status, 'received', content.friendly_name);
      assert.equal(content.approval_requests?.name, content.friendly_name);
    }
  });

  check('emits one HX Content SID per templateKey:language key, as valid JSON', () => {
    const keys = Object.keys(first.sidMap);
    assert.equal(keys.length, EXPECTED_TEMPLATE_COUNT);
    assert.deepEqual(keys.slice().sort(), plans.map((plan) => plan.sidKey).sort());
    for (const [key, sid] of Object.entries(first.sidMap)) {
      assert.match(sid, /^HX[0-9a-f]{32}$/, key);
    }
    const line = envVarLine(first.sidMap);
    assert.ok(line.startsWith("TWILIO_WHATSAPP_CONTENT_SIDS='") && line.endsWith("'"));
    assert.deepEqual(JSON.parse(line.slice("TWILIO_WHATSAPP_CONTENT_SIDS='".length, -1)), first.sidMap);
  });

  check('never puts the auth token anywhere but the Authorization header', () => {
    for (const request of fake.requests) {
      const serialised = `${request.path}${request.search}${JSON.stringify(request.body ?? {})}`;
      assert.equal(serialised.includes(AUTH_TOKEN), false, `${request.method} ${request.path}`);
    }
  });

  // ------------------------------------------------------------- second run
  const requestsBefore = fake.requests.length;
  const second = await createWhatsappTemplates({ api: apiFor(fake), plans });

  check('re-running changes nothing, even though the API echoes back more than it was sent', () => {
    // The fake stores an extra `type: QUICK_REPLY` on every action and a `url`/`links` pair, as Twilio does; a
    // whole-object comparison would call that drift and rewrite all 112 templates on every run.
    const stored = [...fake.contents.values()][0];
    assert.equal(stored.types['twilio/quick-reply'].actions[0].type, 'QUICK_REPLY');
    assert.ok(stored.url);
    assert.deepEqual(summarise(second.results), {
      created: 0,
      updated: 0,
      unchanged: EXPECTED_TEMPLATE_COUNT,
      frozen: 0,
      failed: 0,
      submitted: 0,
    });
    assert.deepEqual(second.sidMap, first.sidMap);
    assert.equal(fake.contents.size, EXPECTED_TEMPLATE_COUNT);
    const listOnly = fake.requests.slice(requestsBefore);
    assert.equal(
      listOnly.every((request) => request.method === 'GET'),
      true,
      'a re-run wrote to the Content API',
    );
  });

  // --------------------------------------------------- drift, still editable
  const editable = plans[0];
  fake.setBody(editable.name, 'stale copy {{1}}');
  fake.setApproval(editable.name, null);
  const afterEdit = await createWhatsappTemplates({ api: apiFor(fake), plans });

  check('updates a template whose seed copy changed, keeping its Content SID, and resubmits it', () => {
    const result = afterEdit.results.find((candidate) => candidate.sidKey === editable.sidKey);
    assert.equal(result.action, 'updated');
    assert.equal(result.submitted, true);
    assert.equal(result.sid, first.sidMap[editable.sidKey]);
    assert.equal(fake.byName(editable.name).types['twilio/quick-reply'].body, editable.text);
    assert.equal(fake.contents.size, EXPECTED_TEMPLATE_COUNT);
    assert.equal(summarise(afterEdit.results).updated, 1);
  });

  // ------------------------------------------------- drift, frozen by Meta
  const frozen = plans[1];
  fake.setBody(frozen.name, 'stale approved copy {{1}}');
  const afterFreeze = await createWhatsappTemplates({ api: apiFor(fake), plans });

  check('reports — and does not touch — a template Meta has already seen whose copy has changed', () => {
    const result = afterFreeze.results.find((candidate) => candidate.sidKey === frozen.sidKey);
    assert.equal(result.action, 'frozen');
    assert.match(result.problem, /cannot edit a submitted template/);
    assert.equal(result.sid, first.sidMap[frozen.sidKey]);
    assert.equal(fake.byName(frozen.name).types['twilio/quick-reply'].body, 'stale approved copy {{1}}');
    assert.equal(summarise(afterFreeze.results).frozen, 1);
    assert.equal(afterFreeze.results.filter((candidate) => candidate.problem).length, 1);
  });

  // ------------------------------------------- the approval path's spelling
  const capitalised = createFakeContentApi({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    approvalPathSegment: 'WhatsApp',
  });
  const withFallback = await createWhatsappTemplates({ api: apiFor(capitalised), plans });

  check('still submits when the approval path is spelled /ApprovalRequests/WhatsApp', () => {
    assert.equal(summarise(withFallback.results).submitted, EXPECTED_TEMPLATE_COUNT);
    assert.ok(capitalised.requests.some((request) => request.path.endsWith('/ApprovalRequests/whatsapp')));
    assert.ok(capitalised.requests.some((request) => request.path.endsWith('/ApprovalRequests/WhatsApp')));
  });

  // ------------------------------------------------------- failure handling
  const throttled = createFakeContentApi({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
  throttled.failNext({
    method: 'POST',
    pathIncludes: '/v1/Content',
    status: 429,
    code: 20429,
    message: 'Too Many Requests',
  });
  const afterThrottle = await createWhatsappTemplates({ api: apiFor(throttled), plans });

  check('loses one template, not the run, when Twilio rejects a single request', () => {
    const counts = summarise(afterThrottle.results);
    assert.equal(counts.failed, 1);
    assert.equal(counts.created, EXPECTED_TEMPLATE_COUNT - 1);
    assert.equal(Object.keys(afterThrottle.sidMap).length, EXPECTED_TEMPLATE_COUNT - 1);
    assert.match(afterThrottle.results.find((result) => result.action === 'failed').problem, /HTTP 429/);
  });

  const approvalDown = createFakeContentApi({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
  approvalDown.failNext({
    method: 'POST',
    pathIncludes: '/ApprovalRequests/',
    status: 500,
    code: 20500,
    message: 'Internal Server Error',
  });
  const afterApprovalFailure = await createWhatsappTemplates({ api: apiFor(approvalDown), plans });

  check('keeps the Content SID of a template whose approval request failed, and reports the failure', () => {
    const failed = afterApprovalFailure.results.find((result) => result.action === 'failed');
    assert.match(failed.problem, /HTTP 500/);
    assert.match(afterApprovalFailure.sidMap[failed.sidKey], /^HX[0-9a-f]{32}$/);
    assert.equal(Object.keys(afterApprovalFailure.sidMap).length, EXPECTED_TEMPLATE_COUNT);
    assert.equal(approvalDown.contents.size, EXPECTED_TEMPLATE_COUNT);
  });

  const wrongCredentials = createFakeContentApi({ accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN });
  const unauthorised = createTwilioContentApi({
    accountSid: ACCOUNT_SID,
    authToken: 'wrong-auth-token',
    fetchImpl: wrongCredentials.fetchImpl,
  });

  await assert.rejects(
    () => createWhatsappTemplates({ api: unauthorised, plans }),
    /HTTP 401/,
    'bad credentials must stop the run before anything is created',
  );
  check('stops on bad credentials instead of creating anything', () => {
    assert.equal(wrongCredentials.contents.size, 0);
  });

  process.stderr.write(`\n# ${checks} assertions passed against the fake Content API; nothing was sent to Twilio.\n`);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(first.sidMap)}\n`);
  }
  return 0;
}
