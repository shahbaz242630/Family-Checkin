# Message copy review — native-speaker sign-off tracker

Status: every non-English row is a machine translation, **not reviewed** · Last updated: 2026-09-06 (CB-010 per-language seed)
Source of truth: `apps/backend/prisma/migrations/202609060103_seed_channel_templates_8_languages/migration.sql` (72 bodies × SMS and WhatsApp = 144 rows, `approvedAt` NULL). English is the in-code copy in `message-catalog.templates.ts`.
Rule: BRD FR-LNG-02 — no unreviewed copy reaches a real phone. Fake mode is the only consumer until a row below says "reviewed".

## Status by template key × language

MT = machine translation by the engineering agent (Claude) on 2026-09-06, needs native review. EN = source copy, product-reviewed in PR #19.

| Template key                            | en | ar | es | hi | ur | ml | ta | bn |
| --------------------------------------- | -- | -- | -- | -- | -- | -- | -- | -- |
| `consent_request`                       | EN | MT | MT | MT | MT | MT | MT | MT |
| `checkin_daily`                         | EN | MT | MT | MT | MT | MT | MT | MT |
| `checkin_retry`                         | EN | MT | MT | MT | MT | MT | MT | MT |
| `receiver_checkins_paused`              | EN | MT | MT | MT | MT | MT | MT | MT |
| `receiver_checkins_ended`               | EN | MT | MT | MT | MT | MT | MT | MT |
| `account_step_up_otp`                   | EN | MT | MT | MT | MT | MT | MT | MT |
| `backup_contact_missed_checkin_alert`   | EN | MT | MT | MT | MT | MT | MT | MT |
| `backup_contact_help_alert`             | EN | MT | MT | MT | MT | MT | MT | MT |
| `backup_contact_sender_requested_alert` | EN | MT | MT | MT | MT | MT | MT | MT |

When a language column is fully reviewed, change its cells to `OK <date> <reviewer initials>` and set `approvedAt` on those rows.

## Review instructions (give this section to the reviewer)

1. Read each body as the person receiving it would: an older relative (receiver rows), or a friend/neighbour asked to help (backup rows). It must sound like a respectful, warm human — not a bank, not a machine. Formal "you" (usted / आप / آپ / താങ്കൾ / நீங்கள் / আপনি) throughout.
2. Do not translate or change the words `YES`, `HELP`, `STOP`, `REPORT`, `DONE` or the brand `Nearby`. Receivers type these words back; the parser only understands the Latin spelling.
3. Do not touch anything inside `{{…}}`. `{{name}}` is filled with a real value; `{{#name}} … {{/name}}` is a sentence that is dropped when the value is missing — the text inside must still read correctly when kept and the message must still flow when it is dropped. A `{{personalNote}}` value is quoted with straight `"…"`.
4. Length: with every optional sentence present and typical names, the message must stay under 320 characters (about 5 SMS segments in a non-Latin script). Shorter is better; do not add courtesies that lengthen it.
5. Known issues to check, per language:
   - **ar**: imperatives (`أرسل`) are masculine; sentences were written to avoid gendered verbs where possible ("رسالة من … للاطمئنان عليك"). Confirm the neutral phrasing reads naturally; dual/plural rule for `{{validityMinutes}} دقائق` (currently always 10 minutes).
   - **hi / ur**: honorific plural (`चाहते हैं` / `چاہتے ہیں`) is used for the sender regardless of gender; greeting is `नमस्ते` / `محترم` (chosen to be religion-neutral) — confirm or propose better.
   - **bn**: greeting `প্রিয়` (dear) chosen over `নমস্কার` / `আসসালামু আলাইকুম` to stay neutral — confirm.
   - **ml / ta**: honorific forms (`അവർ`, `അവர்`) refer to the sender/receiver; suffixes attached to `Nearby` with a hyphen (`Nearby-യോട്`, `Nearby-யிடம்`) — confirm this is the accepted way to inflect a Latin brand name.
   - **es**: `usted` throughout; `REPORT para reportar` (not `denunciar`) chosen to keep the tone light — confirm for the target market.
   - **all**: `{{channelsTried}}` is filled in English ("WhatsApp and SMS", "a phone call") by `describeChannelsTried` — flag if that reads badly; localising it is a follow-up.
6. Return corrections as the full corrected sentence per `templateKey` × language (not diffs). Engineering applies them with a new migration that `UPDATE`s `bodyText` and sets `approvedAt`, then re-runs `message-catalog.seed.spec.ts` (placeholder set, keywords, length are asserted automatically).

## How to see a rendered message without sending anything

Start the backend in fake mode (`docs/EMULATOR_RUNBOOK.md` §3), create a receiver with `language: "ar"` (or any code above), trigger `POST /operations/check-ins/run`, then read the body from `GET /receiver-replies/fake/outbound` or the `[fake-provider]` terminal line. The in-code English copy is used only for a language that has no active row.
