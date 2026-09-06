# Message copy review — native-speaker sign-off tracker

Status: every non-English row is a machine translation, **not reviewed** · Last updated: 2026-09-06 (CB-010 per-language seed; CB-079 neutral sender phrases and CB-022 spoken thank-yous added below)
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

## Other machine-translated strings, also unreviewed

### Neutral sender wording (CB-079, `message-catalog.templates.ts` `NEUTRAL_SENDER_DISPLAY_NAMES_BY_LANGUAGE`)

Used in place of `{{senderDisplayName}}` when the sender has no stored name. The receiver phrase replaces "your family member" in receiver messages; the backup phrase replaces "their family member" in the three `backup_contact_*` alerts and was kept possessive-free because the seeded sentences use it both before and after the receiver's name.

| Language | Receiver phrase ("your family member") | Backup-contact phrase ("their family member") | Check                                                                                                   |
| -------- | -------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ar       | أحد أفراد عائلتك                        | أحد أفراد العائلة                              | reads after "بطلب من", "رسالة من", "ملاحظة من"                                                           |
| es       | un familiar suyo                       | un familiar                                   | lowercase mid-sentence after "Hola {{receiverName}},"                                                    |
| hi       | आपके परिवार के एक सदस्य                | परिवार के एक सदस्य                            | honorific plural verbs (चाहते हैं) still agree                                                           |
| ur       | آپ کے خاندان کے ایک فرد                | خاندان کے ایک فرد                             | same                                                                                                    |
| ml       | താങ്കളുടെ ഒരു കുടുംബാംഗം               | ഒരു കുടുംബാംഗം                                | "താങ്കളുടെ" appears twice in `checkin_daily` (phrase + സുഖവിവരം) — acceptable?                          |
| ta       | உங்கள் குடும்பத்தினர் ஒருவர்            | குடும்பத்தினர் ஒருவர்                          | honorific verb (விசாரிக்கிறார்) with "ஒருவர்"                                                             |
| bn       | আপনার পরিবারের একজন সদস্য              | পরিবারের একজন সদস্য                            | `backup_contact_missed_checkin_alert` attaches "-এর" to the phrase ("সদস্য-এর") — propose the inflected form |

### Spoken thank-you after a keypress (CB-022, `twilio-rendering.ts` `TWILIO_VOICE_REPLY_SAY`)

One sentence per language, read by a Twilio text-to-speech voice at the end of every check-in call; the same sentence whatever digit was pressed. Twilio has no Urdu voice, so `ur` is the Hindi voice reading Hindustani in Devanagari — confirm this is acceptable to Urdu-speaking receivers, or propose an English fallback instead.

| Language | Sentence                                                | Voice                           |
| -------- | ------------------------------------------------------- | ------------------------------- |
| en       | Thank you. Your answer has been received. Goodbye.      | `Polly.Amy` (en-GB)             |
| ar       | شكراً لك. تم استلام ردك. مع السلامة.                     | `Google.ar-XA-Standard-A`       |
| es       | Gracias. Hemos recibido su respuesta. Adiós.            | `Google.es-ES-Standard-A`       |
| hi       | धन्यवाद। आपका जवाब मिल गया है। नमस्ते।                     | `Google.hi-IN-Standard-A`       |
| ur       | शुक्रिया। आपका जवाब मिल गया है। ख़ुदा हाफ़िज़।             | `Google.hi-IN-Standard-A` (hi-IN) |
| ml       | നന്ദി. താങ്കളുടെ മറുപടി ലഭിച്ചു. നമസ്കാരം.               | `Google.ml-IN-Standard-A`       |
| ta       | நன்றி. உங்கள் பதில் கிடைத்தது. வணக்கம்.                   | `Google.ta-IN-Standard-A`       |
| bn       | ধন্যবাদ। আপনার উত্তর পাওয়া গেছে। ভালো থাকবেন।            | `Google.bn-IN-Standard-A`       |

The recorded voice prompts themselves (what each `.wav` must say) are scripted in English in `docs/providers/twilio.md` §4.1 and need translating and recording per language once decision 3 is taken.

## How to see a rendered message without sending anything

Start the backend in fake mode (`docs/EMULATOR_RUNBOOK.md` §3), create a receiver with `language: "ar"` (or any code above), trigger `POST /operations/check-ins/run`, then read the body from `GET /receiver-replies/fake/outbound` or the `[fake-provider]` terminal line. The in-code English copy is used only for a language that has no active row.
