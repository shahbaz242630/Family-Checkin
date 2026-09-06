# WhatsApp — Twilio Content Templates, approval and Content SIDs

Last updated: 2026-09-06 (sprint 3, CB-020). WhatsApp goes through Twilio only (decision 8). Every
business-initiated WhatsApp message must be a Meta-approved template, so the backend never sends free text on
WhatsApp: it sends an approved **Content SID** plus numbered variables. This page lists every template to create,
the exact text, the numbering, the buttons, and where the approved SIDs go. Console and webhook setup is in
`docs/providers/twilio.md`.

## 1. How a WhatsApp send works

`WhatsappProvider` (`apps/backend/src/modules/channels/whatsapp.provider.ts`) receives the same
`{ templateKey, language, variables }` as SMS, then:

1. Picks the language: the receiver's language (`ar-EG`, then `ar`), then English. The template text comes from
   the `channel_templates` row for `(templateKey, language, WHATSAPP)` seeded by migration `202609060103` (the
   English rows equal the in-code copy), so the text below and the text the code numbers from are the same rows.
2. Picks the **variant** (§3): the most specific one whose optional variables are all present, e.g.
   `checkin_daily+personalNote:ar` when the sender wrote a note and that template is approved, else
   `checkin_daily:ar`. An optional value with no approved variant to carry it is dropped, never sent as an empty
   placeholder.
3. Numbers the placeholders by first appearance in that variant's text (Meta's rule for positional parameters) and
   sends `ContentSid` + `ContentVariables` as `{"1": "...", "2": "..."}`. A blank required variable throws before
   any HTTP call, exactly like an SMS render.
4. Localises the neutral sender wording to the template's language ("your family member" → "أحد أفراد عائلتك",
   CB-079) and reports `rendering: { language, fallback }` for the audit row.

The Content SID is looked up in `TWILIO_WHATSAPP_CONTENT_SIDS` (§4) by `<variant>:<language>`; a language-less
`<variant>` key is the English default. `channel_templates.externalId` is not read by the backend today; record
the SID there too if you want it next to the text, but the env var is what sends.

## 2. Quick-reply buttons

Receivers tap instead of typing. Twilio posts the tap to the inbound webhook with `ButtonPayload` (the button
`id`) and `ButtonText` (the localised title); the backend uses `ButtonPayload` first, so the **id must be the
English keyword** the reply parser understands, whatever the title says:

| Button id (`ButtonPayload`) | Meaning                        | Used on                                                                 |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `YES`                       | I am okay / I agree            | `consent_request`, `checkin_daily`, `checkin_retry`                     |
| `HELP`                      | I need help (escalates)        | `checkin_daily`, `checkin_retry`                                        |
| `STOP`                      | Stop the check-ins (7-day cooldown) | `consent_request`, `checkin_daily`, `checkin_retry`, `receiver_checkins_paused` |
| `REPORT`                    | Report abuse (pauses for review) | `consent_request`, `receiver_checkins_paused`, `receiver_checkins_ended` |
| `DONE`                      | Backup contact reached them    | the three `backup_contact_*` alerts                                     |

Rules: at most three buttons per template (the safe limit across Twilio content types and Meta), button titles in
the template's language and short (≤ 20 characters), ids exactly as above in capitals. A receiver who types the
word instead of tapping is handled the same way (`YES`, `Y`, `1`, `OK`, `NO`, `N`, `2`, `HELP`, `STOP`, `REPORT`,
`DONE` — Latin letters only, which is why every body keeps those words untranslated). Where a template lists a
keyword in its text but has no button for it (`REPORT` on the check-ins), typing still works.

Content type to create: `twilio/quick-reply` (body + buttons) for every template in §5; `twilio/text` only if a
channel refuses buttons.

## 3. Variants: what WhatsApp cannot express

Our copy has optional sentences (`{{#personalNote}} Their note: "{{personalNote}}"{{/personalNote}}`); a Meta
template has none, and a parameter cannot be empty. So each catalog template maps onto variants:

- the plain variant drops every optional sentence — this is the minimum to create, one per language;
- `templateKey+section[+section…]` keeps exactly those sentences, in the template's own order.

Create the plain variant first for every key and language (64 templates); add `+personalNote` for
`consent_request`, `checkin_daily` and `checkin_retry` (24 more) so the sender's note reaches WhatsApp receivers;
the backup alerts carry `channelsTried` and `locationInstructions` — create `+channelsTried+locationInstructions`
(24 more) and, if you want the sentence when only one is known, `+channelsTried` and `+locationInstructions` too.
The tables in §5 list the plain and the all-sections variants; the single-section ones follow the same rule (keep
that sentence, number by first appearance).

Numbering follows each language's own word order, so `{{2}}` may be the sender in English and the receiver in
Malayalam; the tables say so wherever a language differs from English. The same variable used twice keeps one
number (the Arabic check-ins mention the sender twice) — if Meta rejects a repeated `{{2}}`, correct that row by
migration (never by editing the seed) and the numbering follows.

## 4. Where the approved SIDs go

`TWILIO_WHATSAPP_CONTENT_SIDS` is one JSON object, parsed at boot (malformed JSON fails boot with a message that
names the variable):

```
TWILIO_WHATSAPP_CONTENT_SIDS='{
  "consent_request:en": "HXaaaa…", "consent_request+personalNote:en": "HXbbbb…",
  "consent_request:ar": "HXcccc…", "consent_request+personalNote:ar": "HXdddd…",
  "checkin_daily:en": "HXeeee…", "checkin_daily": "HXeeee…",
  …
}'
```

- Key = `<variant>:<language>` exactly as in the tables; the language codes are the seed's two-letter codes.
- A key without `:language` is the English default for that variant, used when neither the receiver's language
  nor `:en` is configured.
- A receiver whose language has no approved template gets the English one with `renderFallback: true` in the audit
  row; a template key with no SID at all fails the send with
  `WhatsApp content template is not configured for <key>:<language>` and the cascade moves to the next channel.
- Values are the `HX…` Content SIDs from the Content Template Builder, one per approved template; restart the
  backend after changing the variable.

## 5. Meta approval, step by step

1. Twilio Console → Messaging → Content Template Builder → Create new. Name it `<variant>_<language>`
   (`checkin_daily_personalnote_ar`), language = the language of the text, type `twilio/quick-reply`.
2. Paste the body from the table below **verbatim** (keep `{{1}}`, `{{2}}` … and the Latin keywords), add the
   buttons for that key with the ids from §2 and titles in that language, and give each variable a sample value
   (a name, a note) — Meta reviews the samples.
3. Save, then "Submit for WhatsApp approval": category **Utility** (transactional, non-promotional; a daily
   check-in, a consent request and a safety alert are utility messages, and Meta reclassifies marketing at a higher
   price), name as in step 1.
4. Approval usually takes minutes, sometimes up to 24 hours; the status shows in the builder and by
   `GET https://content.twilio.com/v1/Content/<HX…>/ApprovalRequests`. Rejections name the reason (most often a
   sample value or a variable-heavy text); fix the copy by migration and resubmit.
5. Copy the Content SID (`HX…`) into `TWILIO_WHATSAPP_CONTENT_SIDS` under its key, redeploy, and send one test to a
   team phone in fake-then-configured order (rule 2 in `PROJECT_HANDOFF.md`).

Every non-English body below is a machine translation with `approvedAt` NULL in `channel_templates`
(`docs/handoffs/message-copy-review.md`): submit to Meta only after native review, or the approved template will
have to be resubmitted when the copy changes. `account_step_up_otp` is not listed: it goes to the sender over SMS.

## 6. Templates (generated from migration `202609060103`)

Generated by the same `whatsappTemplateText` the provider uses, so text and numbering cannot disagree with the
code. Placeholder legend is per variant; a row says "Numbering in this language" when its order differs from
English.

### `consent_request`

Audience: receiver. Quick-reply buttons: YES, STOP, REPORT. Optional sections: `personalNote`. Two templates per language: the plain one and `consent_request+personalNote` (all optional sentences present).

#### `consent_request` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `consent_request:en` | Hi {{1}}, {{2}} asked Nearby to check in on you with a short daily message. Reply YES to agree. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `consent_request:ar` | مرحباً {{1}}، بناءً على طلب {{2}} ستصلك من Nearby رسالة قصيرة كل يوم للاطمئنان عليك. أرسل YES للموافقة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `consent_request:es` | Hola {{1}}, {{2}} ha pedido a Nearby que le enviemos un breve mensaje cada día para saber cómo está. Responda YES para aceptar. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `consent_request:hi` | नमस्ते {{1}}, {{2}} ने Nearby से कहा है कि हम हर दिन एक छोटे संदेश से आपकी खैरियत पूछें। सहमति के लिए YES लिखकर जवाब दें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `consent_request:ur` | محترم {{1}}، {{2}} نے Nearby سے کہا ہے کہ ہم ہر روز ایک مختصر پیغام کے ذریعے آپ کی خیریت دریافت کریں۔ رضامندی کے لیے YES لکھ کر جواب دیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `consent_request:ml` | നമസ്കാരം {{1}}, ദിവസവും ഒരു ചെറിയ സന്ദേശത്തിലൂടെ താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കാൻ {{2}} Nearby-യോട് ആവശ്യപ്പെട്ടിട്ടുണ്ട്. സമ്മതമാണെങ്കിൽ YES എന്ന് മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `consent_request:ta` | வணக்கம் {{1}}, தினமும் ஒரு சிறிய செய்தி மூலம் உங்கள் நலம் விசாரிக்க {{2}} Nearby-யிடம் கேட்டுள்ளார். சம்மதம் என்றால் YES என்று பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `consent_request:bn` | প্রিয় {{1}}, {{2}} Nearby-কে অনুরোধ করেছেন যে আমরা প্রতিদিন একটি ছোট বার্তায় আপনার খবর নিই। সম্মতি দিতে YES লিখে উত্তর দিন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

#### `consent_request+personalNote` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName, `{{3}}` = personalNote

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `consent_request+personalNote:en` | Hi {{1}}, {{2}} asked Nearby to check in on you with a short daily message. Their note: "{{3}}" Reply YES to agree. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `consent_request+personalNote:ar` | مرحباً {{1}}، بناءً على طلب {{2}} ستصلك من Nearby رسالة قصيرة كل يوم للاطمئنان عليك. ملاحظة من {{2}}: "{{3}}" أرسل YES للموافقة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `consent_request+personalNote:es` | Hola {{1}}, {{2}} ha pedido a Nearby que le enviemos un breve mensaje cada día para saber cómo está. Su nota: "{{3}}" Responda YES para aceptar. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `consent_request+personalNote:hi` | नमस्ते {{1}}, {{2}} ने Nearby से कहा है कि हम हर दिन एक छोटे संदेश से आपकी खैरियत पूछें। उनका संदेश: "{{3}}" सहमति के लिए YES लिखकर जवाब दें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `consent_request+personalNote:ur` | محترم {{1}}، {{2}} نے Nearby سے کہا ہے کہ ہم ہر روز ایک مختصر پیغام کے ذریعے آپ کی خیریت دریافت کریں۔ ان کا پیغام: "{{3}}" رضامندی کے لیے YES لکھ کر جواب دیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `consent_request+personalNote:ml` | നമസ്കാരം {{1}}, ദിവസവും ഒരു ചെറിയ സന്ദേശത്തിലൂടെ താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കാൻ {{2}} Nearby-യോട് ആവശ്യപ്പെട്ടിട്ടുണ്ട്. അവരുടെ കുറിപ്പ്: "{{3}}" സമ്മതമാണെങ്കിൽ YES എന്ന് മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `consent_request+personalNote:ta` | வணக்கம் {{1}}, தினமும் ஒரு சிறிய செய்தி மூலம் உங்கள் நலம் விசாரிக்க {{2}} Nearby-யிடம் கேட்டுள்ளார். அவரின் குறிப்பு: "{{3}}" சம்மதம் என்றால் YES என்று பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `consent_request+personalNote:bn` | প্রিয় {{1}}, {{2}} Nearby-কে অনুরোধ করেছেন যে আমরা প্রতিদিন একটি ছোট বার্তায় আপনার খবর নিই। তাঁর বার্তা: "{{3}}" সম্মতি দিতে YES লিখে উত্তর দিন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

### `checkin_daily`

Audience: receiver. Quick-reply buttons: YES, HELP, STOP. Optional sections: `personalNote`. Two templates per language: the plain one and `checkin_daily+personalNote` (all optional sentences present).

#### `checkin_daily` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `checkin_daily:en` | Hi {{1}}, {{2}} is checking in on you today. Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `checkin_daily:ar` | مرحباً {{1}}، هذه رسالة من {{2}} للاطمئنان عليك اليوم. أرسل YES إذا كنت بخير أو HELP إذا كنت بحاجة إلى مساعدة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `checkin_daily:es` | Hola {{1}}, {{2}} quiere saber cómo está usted hoy. Responda YES si está bien o HELP si necesita ayuda. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `checkin_daily:hi` | नमस्ते {{1}}, {{2}} आज आपकी खैरियत जानना चाहते हैं। अगर आप ठीक हैं तो YES लिखें, मदद चाहिए तो HELP लिखें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `checkin_daily:ur` | محترم {{1}}، {{2}} آج آپ کی خیریت جاننا چاہتے ہیں۔ اگر آپ ٹھیک ہیں تو YES لکھیں، مدد درکار ہو تو HELP لکھیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `checkin_daily:ml` | നമസ്കാരം {{1}}, {{2}} ഇന്ന് താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കുന്നു. സുഖമാണെങ്കിൽ YES എന്നും സഹായം വേണമെങ്കിൽ HELP എന്നും മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `checkin_daily:ta` | வணக்கம் {{1}}, {{2}} இன்று உங்கள் நலம் விசாரிக்கிறார். நலமாக இருந்தால் YES என்றும், உதவி தேவைப்பட்டால் HELP என்றும் பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `checkin_daily:bn` | প্রিয় {{1}}, {{2}} আজ আপনার খবর নিতে চান। ভালো থাকলে YES লিখুন, সাহায্য লাগলে HELP লিখুন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

#### `checkin_daily+personalNote` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName, `{{3}}` = personalNote

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `checkin_daily+personalNote:en` | Hi {{1}}, {{2}} is checking in on you today. Their note: "{{3}}" Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `checkin_daily+personalNote:ar` | مرحباً {{1}}، هذه رسالة من {{2}} للاطمئنان عليك اليوم. ملاحظة من {{2}}: "{{3}}" أرسل YES إذا كنت بخير أو HELP إذا كنت بحاجة إلى مساعدة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `checkin_daily+personalNote:es` | Hola {{1}}, {{2}} quiere saber cómo está usted hoy. Su nota: "{{3}}" Responda YES si está bien o HELP si necesita ayuda. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `checkin_daily+personalNote:hi` | नमस्ते {{1}}, {{2}} आज आपकी खैरियत जानना चाहते हैं। उनका संदेश: "{{3}}" अगर आप ठीक हैं तो YES लिखें, मदद चाहिए तो HELP लिखें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `checkin_daily+personalNote:ur` | محترم {{1}}، {{2}} آج آپ کی خیریت جاننا چاہتے ہیں۔ ان کا پیغام: "{{3}}" اگر آپ ٹھیک ہیں تو YES لکھیں، مدد درکار ہو تو HELP لکھیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `checkin_daily+personalNote:ml` | നമസ്കാരം {{1}}, {{2}} ഇന്ന് താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കുന്നു. അവരുടെ കുറിപ്പ്: "{{3}}" സുഖമാണെങ്കിൽ YES എന്നും സഹായം വേണമെങ്കിൽ HELP എന്നും മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `checkin_daily+personalNote:ta` | வணக்கம் {{1}}, {{2}} இன்று உங்கள் நலம் விசாரிக்கிறார். அவரின் குறிப்பு: "{{3}}" நலமாக இருந்தால் YES என்றும், உதவி தேவைப்பட்டால் HELP என்றும் பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `checkin_daily+personalNote:bn` | প্রিয় {{1}}, {{2}} আজ আপনার খবর নিতে চান। তাঁর বার্তা: "{{3}}" ভালো থাকলে YES লিখুন, সাহায্য লাগলে HELP লিখুন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

### `checkin_retry`

Audience: receiver. Quick-reply buttons: YES, HELP, STOP. Optional sections: `personalNote`. Two templates per language: the plain one and `checkin_retry+personalNote` (all optional sentences present).

#### `checkin_retry` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `checkin_retry:en` | Hi {{1}}, we have not heard back from you yet. {{2}} is checking in on you. Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `checkin_retry:ar` | مرحباً {{1}}، لم يصلنا ردك بعد. هذه رسالة من {{2}} للاطمئنان عليك. أرسل YES إذا كنت بخير أو HELP إذا كنت بحاجة إلى مساعدة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `checkin_retry:es` | Hola {{1}}, aún no hemos recibido su respuesta. {{2}} quiere saber cómo está usted. Responda YES si está bien o HELP si necesita ayuda. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `checkin_retry:hi` | नमस्ते {{1}}, हमें अभी तक आपका जवाब नहीं मिला है। {{2}} आपकी खैरियत जानना चाहते हैं। अगर आप ठीक हैं तो YES लिखें, मदद चाहिए तो HELP लिखें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `checkin_retry:ur` | محترم {{1}}، ہمیں ابھی تک آپ کا جواب نہیں ملا۔ {{2}} آپ کی خیریت جاننا چاہتے ہیں۔ اگر آپ ٹھیک ہیں تو YES لکھیں، مدد درکار ہو تو HELP لکھیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `checkin_retry:ml` | നമസ്കാരം {{1}}, താങ്കളുടെ മറുപടി ഇതുവരെ ലഭിച്ചിട്ടില്ല. {{2}} താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കുന്നു. സുഖമാണെങ്കിൽ YES എന്നും സഹായം വേണമെങ്കിൽ HELP എന്നും മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `checkin_retry:ta` | வணக்கம் {{1}}, உங்கள் பதில் இன்னும் எங்களுக்கு வரவில்லை. {{2}} உங்கள் நலம் விசாரிக்கிறார். நலமாக இருந்தால் YES என்றும், உதவி தேவைப்பட்டால் HELP என்றும் பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `checkin_retry:bn` | প্রিয় {{1}}, আপনার উত্তর এখনও আমরা পাইনি। {{2}} আপনার খবর নিতে চান। ভালো থাকলে YES লিখুন, সাহায্য লাগলে HELP লিখুন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

#### `checkin_retry+personalNote` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName, `{{3}}` = personalNote

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `checkin_retry+personalNote:en` | Hi {{1}}, we have not heard back from you yet. {{2}} is checking in on you. Their note: "{{3}}" Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `checkin_retry+personalNote:ar` | مرحباً {{1}}، لم يصلنا ردك بعد. هذه رسالة من {{2}} للاطمئنان عليك. ملاحظة من {{2}}: "{{3}}" أرسل YES إذا كنت بخير أو HELP إذا كنت بحاجة إلى مساعدة. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `checkin_retry+personalNote:es` | Hola {{1}}, aún no hemos recibido su respuesta. {{2}} quiere saber cómo está usted. Su nota: "{{3}}" Responda YES si está bien o HELP si necesita ayuda. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `checkin_retry+personalNote:hi` | नमस्ते {{1}}, हमें अभी तक आपका जवाब नहीं मिला है। {{2}} आपकी खैरियत जानना चाहते हैं। उनका संदेश: "{{3}}" अगर आप ठीक हैं तो YES लिखें, मदद चाहिए तो HELP लिखें। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `checkin_retry+personalNote:ur` | محترم {{1}}، ہمیں ابھی تک آپ کا جواب نہیں ملا۔ {{2}} آپ کی خیریت جاننا چاہتے ہیں۔ ان کا پیغام: "{{3}}" اگر آپ ٹھیک ہیں تو YES لکھیں، مدد درکار ہو تو HELP لکھیں۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `checkin_retry+personalNote:ml` | നമസ്കാരം {{1}}, താങ്കളുടെ മറുപടി ഇതുവരെ ലഭിച്ചിട്ടില്ല. {{2}} താങ്കളുടെ സുഖവിവരം അന്വേഷിക്കുന്നു. അവരുടെ കുറിപ്പ്: "{{3}}" സുഖമാണെങ്കിൽ YES എന്നും സഹായം വേണമെങ്കിൽ HELP എന്നും മറുപടി നൽകുക. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `checkin_retry+personalNote:ta` | வணக்கம் {{1}}, உங்கள் பதில் இன்னும் எங்களுக்கு வரவில்லை. {{2}} உங்கள் நலம் விசாரிக்கிறார். அவரின் குறிப்பு: "{{3}}" நலமாக இருந்தால் YES என்றும், உதவி தேவைப்பட்டால் HELP என்றும் பதிலளிக்கவும். நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `checkin_retry+personalNote:bn` | প্রিয় {{1}}, আপনার উত্তর এখনও আমরা পাইনি। {{2}} আপনার খবর নিতে চান। তাঁর বার্তা: "{{3}}" ভালো থাকলে YES লিখুন, সাহায্য লাগলে HELP লিখুন। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

### `receiver_checkins_paused`

Audience: receiver. Quick-reply buttons: STOP, REPORT. No optional sections: one template per language.

#### `receiver_checkins_paused` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `receiver_checkins_paused:en` | Hi {{1}}, {{2}} has paused your Nearby check-ins. You will not get check-in messages until they are resumed. Reply STOP to stop, REPORT to report. |
| Arabic (ar) | `receiver_checkins_paused:ar` | مرحباً {{1}}، تم إيقاف رسائل الاطمئنان من Nearby مؤقتاً بطلب من {{2}}. لن تصلك رسائل اطمئنان حتى يتم استئنافها. أرسل STOP للإيقاف أو REPORT للإبلاغ. |
| Spanish (es) | `receiver_checkins_paused:es` | Hola {{1}}, {{2}} ha pausado sus mensajes de Nearby. No recibirá mensajes hasta que se reanuden. Responda STOP para detener o REPORT para reportar. |
| Hindi (hi) | `receiver_checkins_paused:hi` | नमस्ते {{1}}, {{2}} ने आपके Nearby संदेश कुछ समय के लिए रोक दिए हैं। दोबारा शुरू होने तक आपको संदेश नहीं मिलेंगे। रोकने के लिए STOP, शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `receiver_checkins_paused:ur` | محترم {{1}}، {{2}} نے آپ کے Nearby پیغامات کچھ وقت کے لیے روک دیے ہیں۔ دوبارہ شروع ہونے تک آپ کو پیغامات نہیں ملیں گے۔ روکنے کے لیے STOP، شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `receiver_checkins_paused:ml` | നമസ്കാരം {{1}}, {{2}} താങ്കളുടെ Nearby സന്ദേശങ്ങൾ താൽക്കാലികമായി നിർത്തിവച്ചിരിക്കുന്നു. പുനരാരംഭിക്കുന്നത് വരെ സന്ദേശങ്ങൾ ലഭിക്കില്ല. നിർത്താൻ STOP, പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `receiver_checkins_paused:ta` | வணக்கம் {{1}}, {{2}} உங்கள் Nearby செய்திகளை தற்காலிகமாக நிறுத்தியுள்ளார். மீண்டும் தொடங்கும் வரை செய்திகள் வராது. நிறுத்த STOP, புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `receiver_checkins_paused:bn` | প্রিয় {{1}}, {{2}} আপনার Nearby বার্তাগুলি সাময়িকভাবে বন্ধ রেখেছেন। আবার শুরু না হওয়া পর্যন্ত আপনি বার্তা পাবেন না। বন্ধ করতে STOP, অভিযোগ জানাতে REPORT লিখুন। |

### `receiver_checkins_ended`

Audience: receiver. Quick-reply buttons: REPORT. No optional sections: one template per language.

#### `receiver_checkins_ended` — placeholders `{{1}}` = receiverName, `{{2}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `receiver_checkins_ended:en` | Hi {{1}}, {{2}} has ended your Nearby check-ins. You will not get any more check-in messages. Reply REPORT to report. |
| Arabic (ar) | `receiver_checkins_ended:ar` | مرحباً {{1}}، تم إنهاء رسائل الاطمئنان من Nearby بطلب من {{2}}. لن تصلك أي رسائل اطمئنان بعد الآن. أرسل REPORT للإبلاغ. |
| Spanish (es) | `receiver_checkins_ended:es` | Hola {{1}}, {{2}} ha finalizado sus mensajes de Nearby. No recibirá más mensajes. Responda REPORT para reportar. |
| Hindi (hi) | `receiver_checkins_ended:hi` | नमस्ते {{1}}, {{2}} ने आपके Nearby संदेश बंद कर दिए हैं। अब आपको और संदेश नहीं मिलेंगे। शिकायत के लिए REPORT लिखें। |
| Urdu (ur) | `receiver_checkins_ended:ur` | محترم {{1}}، {{2}} نے آپ کے Nearby پیغامات ختم کر دیے ہیں۔ اب آپ کو مزید پیغامات نہیں ملیں گے۔ شکایت کے لیے REPORT لکھیں۔ |
| Malayalam (ml) | `receiver_checkins_ended:ml` | നമസ്കാരം {{1}}, {{2}} താങ്കളുടെ Nearby സന്ദേശങ്ങൾ അവസാനിപ്പിച്ചിരിക്കുന്നു. ഇനി സന്ദേശങ്ങൾ ലഭിക്കില്ല. പരാതിപ്പെടാൻ REPORT എന്ന് അയയ്ക്കുക. |
| Tamil (ta) | `receiver_checkins_ended:ta` | வணக்கம் {{1}}, {{2}} உங்கள் Nearby செய்திகளை முடித்துவிட்டார். இனி செய்திகள் வராது. புகார் அளிக்க REPORT என்று அனுப்பவும். |
| Bengali (bn) | `receiver_checkins_ended:bn` | প্রিয় {{1}}, {{2}} আপনার Nearby বার্তাগুলি বন্ধ করে দিয়েছেন। আপনি আর কোনো বার্তা পাবেন না। অভিযোগ জানাতে REPORT লিখুন। |

### `backup_contact_missed_checkin_alert`

Audience: backup contact. Quick-reply buttons: DONE. Optional sections: `channelsTried`, `locationInstructions`. Two templates per language: the plain one and `backup_contact_missed_checkin_alert+channelsTried+locationInstructions` (all optional sentences present).

#### `backup_contact_missed_checkin_alert` — placeholders `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_missed_checkin_alert:en` | Hi {{1}}, this is Nearby. {{2}} did not answer today's check-in from {{3}}. Please check on them. Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_missed_checkin_alert:ar` | مرحباً {{1}}، هذه رسالة من Nearby. لم يصلنا رد من {{2}} على رسالة الاطمئنان اليوم من {{3}}. نرجو الاطمئنان على {{2}}. أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_missed_checkin_alert:es` | Hola {{1}}, le escribe Nearby. {{2}} no ha respondido hoy al mensaje de {{3}}. Por favor, compruebe que está bien. Responda DONE cuando haya hablado con {{2}}. |
| Hindi (hi) | `backup_contact_missed_checkin_alert:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने आज {{3}} के संदेश का जवाब नहीं दिया। कृपया उनकी खैरियत पूछें। उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_missed_checkin_alert:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے آج {{3}} کے پیغام کا جواب نہیں دیا۔ براہ کرم ان کی خیریت دریافت کریں۔ رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_missed_checkin_alert:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}} അയച്ച ഇന്നത്തെ സന്ദേശത്തിന് {{3}} മറുപടി നൽകിയില്ല. ദയവായി അവരെ അന്വേഷിക്കുക. അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName |
| Tamil (ta) | `backup_contact_missed_checkin_alert:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} அனுப்பிய இன்றைய செய்திக்கு {{3}} பதிலளிக்கவில்லை. தயவுசெய்து அவரை விசாரிக்கவும். அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName |
| Bengali (bn) | `backup_contact_missed_checkin_alert:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} আজ {{3}}-এর বার্তার উত্তর দেননি। অনুগ্রহ করে তাঁর খবর নিন। যোগাযোগ হলে DONE লিখুন। |

#### `backup_contact_missed_checkin_alert+channelsTried+locationInstructions` — placeholders `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:en` | Hi {{1}}, this is Nearby. {{2}} did not answer today's check-in from {{3}}. We tried {{4}}. Please check on them. Where to find them: {{5}} Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:ar` | مرحباً {{1}}، هذه رسالة من Nearby. لم يصلنا رد من {{2}} على رسالة الاطمئنان اليوم من {{3}}. حاولنا عبر {{4}}. نرجو الاطمئنان على {{2}}. كيفية الوصول: {{5}} أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:es` | Hola {{1}}, le escribe Nearby. {{2}} no ha respondido hoy al mensaje de {{3}}. Lo intentamos por {{4}}. Por favor, compruebe que está bien. Ubicación: {{5}} Responda DONE cuando haya hablado con {{2}}. |
| Hindi (hi) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने आज {{3}} के संदेश का जवाब नहीं दिया। हमने {{4}} से कोशिश की। कृपया उनकी खैरियत पूछें। पता: {{5}} उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے آج {{3}} کے پیغام کا جواب نہیں دیا۔ ہم نے {{4}} سے کوشش کی۔ براہ کرم ان کی خیریت دریافت کریں۔ پتہ: {{5}} رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}} അയച്ച ഇന്നത്തെ സന്ദേശത്തിന് {{3}} മറുപടി നൽകിയില്ല. {{4}} വഴി ശ്രമിച്ചു. ദയവായി അവരെ അന്വേഷിക്കുക. എവിടെ കാണാം: {{5}} അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Tamil (ta) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} அனுப்பிய இன்றைய செய்திக்கு {{3}} பதிலளிக்கவில்லை. {{4}} மூலம் முயற்சித்தோம். தயவுசெய்து அவரை விசாரிக்கவும். இருப்பிடம்: {{5}} அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Bengali (bn) | `backup_contact_missed_checkin_alert+channelsTried+locationInstructions:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} আজ {{3}}-এর বার্তার উত্তর দেননি। আমরা {{4}}-এর মাধ্যমে চেষ্টা করেছি। অনুগ্রহ করে তাঁর খবর নিন। ঠিকানা: {{5}} যোগাযোগ হলে DONE লিখুন। |

### `backup_contact_help_alert`

Audience: backup contact. Quick-reply buttons: DONE. Optional sections: `channelsTried`, `locationInstructions`. Two templates per language: the plain one and `backup_contact_help_alert+channelsTried+locationInstructions` (all optional sentences present).

#### `backup_contact_help_alert` — placeholders `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_help_alert:en` | Hi {{1}}, this is Nearby. {{2}} asked for help during a check-in from {{3}}. Please contact them now. Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_help_alert:ar` | مرحباً {{1}}، هذه رسالة من Nearby. وصلنا طلب مساعدة من {{2}} أثناء رسالة اطمئنان من {{3}}. نرجو التواصل مع {{2}} الآن. أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_help_alert:es` | Hola {{1}}, le escribe Nearby. {{2}} pidió ayuda durante el mensaje de {{3}}. Por favor, póngase en contacto ahora. Responda DONE cuando haya hablado con {{2}}. |
| Hindi (hi) | `backup_contact_help_alert:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने {{3}} के संदेश पर मदद मांगी है। कृपया उनसे अभी संपर्क करें। उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_help_alert:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے {{3}} کے پیغام پر مدد مانگی ہے۔ براہ کرم ان سے ابھی رابطہ کریں۔ رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_help_alert:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}} അയച്ച സന്ദേശത്തിന് {{3}} സഹായം ചോദിച്ചു. ദയവായി ഉടൻ അവരെ ബന്ധപ്പെടുക. അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName |
| Tamil (ta) | `backup_contact_help_alert:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} அனுப்பிய செய்திக்கு {{3}} உதவி கேட்டுள்ளார். தயவுசெய்து உடனே அவரைத் தொடர்பு கொள்ளவும். அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName |
| Bengali (bn) | `backup_contact_help_alert:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} {{3}}-এর বার্তায় সাহায্য চেয়েছেন। অনুগ্রহ করে এখনই তাঁর সাথে যোগাযোগ করুন। যোগাযোগ হলে DONE লিখুন। |

#### `backup_contact_help_alert+channelsTried+locationInstructions` — placeholders `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_help_alert+channelsTried+locationInstructions:en` | Hi {{1}}, this is Nearby. {{2}} asked for help during a check-in from {{3}}. We reached them by {{4}}. Please contact them now. Where to find them: {{5}} Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_help_alert+channelsTried+locationInstructions:ar` | مرحباً {{1}}، هذه رسالة من Nearby. وصلنا طلب مساعدة من {{2}} أثناء رسالة اطمئنان من {{3}}. تواصلنا عبر {{4}}. نرجو التواصل مع {{2}} الآن. كيفية الوصول: {{5}} أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_help_alert+channelsTried+locationInstructions:es` | Hola {{1}}, le escribe Nearby. {{2}} pidió ayuda durante el mensaje de {{3}}. Nos comunicamos por {{4}}. Por favor, póngase en contacto ahora. Ubicación: {{5}} Responda DONE cuando haya hablado con {{2}}. |
| Hindi (hi) | `backup_contact_help_alert+channelsTried+locationInstructions:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने {{3}} के संदेश पर मदद मांगी है। हमने {{4}} से संपर्क किया। कृपया उनसे अभी संपर्क करें। पता: {{5}} उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_help_alert+channelsTried+locationInstructions:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے {{3}} کے پیغام پر مدد مانگی ہے۔ ہم نے {{4}} سے رابطہ کیا۔ براہ کرم ان سے ابھی رابطہ کریں۔ پتہ: {{5}} رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_help_alert+channelsTried+locationInstructions:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}} അയച്ച സന്ദേശത്തിന് {{3}} സഹായം ചോദിച്ചു. {{4}} വഴി അവരെ ബന്ധപ്പെട്ടു. ദയവായി ഉടൻ അവരെ ബന്ധപ്പെടുക. എവിടെ കാണാം: {{5}} അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Tamil (ta) | `backup_contact_help_alert+channelsTried+locationInstructions:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} அனுப்பிய செய்திக்கு {{3}} உதவி கேட்டுள்ளார். {{4}} மூலம் அவரைத் தொடர்பு கொண்டோம். தயவுசெய்து உடனே அவரைத் தொடர்பு கொள்ளவும். இருப்பிடம்: {{5}} அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Bengali (bn) | `backup_contact_help_alert+channelsTried+locationInstructions:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} {{3}}-এর বার্তায় সাহায্য চেয়েছেন। আমরা {{4}}-এর মাধ্যমে যোগাযোগ করেছি। অনুগ্রহ করে এখনই তাঁর সাথে যোগাযোগ করুন। ঠিকানা: {{5}} যোগাযোগ হলে DONE লিখুন। |

### `backup_contact_sender_requested_alert`

Audience: backup contact. Quick-reply buttons: DONE. Optional sections: `channelsTried`, `locationInstructions`. Two templates per language: the plain one and `backup_contact_sender_requested_alert+channelsTried+locationInstructions` (all optional sentences present).

#### `backup_contact_sender_requested_alert` — placeholders `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_sender_requested_alert:en` | Hi {{1}}, this is Nearby. {{2}} asked us to alert you about {{3}} and would like you to check on them. Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_sender_requested_alert:ar` | مرحباً {{1}}، هذه رسالة من Nearby. بطلب من {{2}}، نرجو منك الاطمئنان على {{3}}. أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_sender_requested_alert:es` | Hola {{1}}, le escribe Nearby. {{2}} nos pidió avisarle sobre {{3}} y le pide que compruebe que está bien. Responda DONE cuando haya hablado con {{3}}. |
| Hindi (hi) | `backup_contact_sender_requested_alert:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने कहा है कि आपको {{3}} के बारे में सूचित करें; कृपया उनकी खैरियत पूछें। उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_sender_requested_alert:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے کہا ہے کہ آپ کو {{3}} کے بارے میں آگاہ کریں؛ براہ کرم ان کی خیریت دریافت کریں۔ رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_sender_requested_alert:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}}-നെ കുറിച്ച് താങ്കളെ അറിയിക്കാൻ {{3}} ആവശ്യപ്പെട്ടു; ദയവായി അവരെ അന്വേഷിക്കുക. അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName |
| Tamil (ta) | `backup_contact_sender_requested_alert:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} குறித்து உங்களுக்குத் தெரிவிக்க {{3}} கேட்டுள்ளார்; தயவுசெய்து அவரை விசாரிக்கவும். அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName |
| Bengali (bn) | `backup_contact_sender_requested_alert:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} বলেছেন {{3}} সম্পর্কে আপনাকে জানাতে; অনুগ্রহ করে তাঁর খবর নিন। যোগাযোগ হলে DONE লিখুন। |

#### `backup_contact_sender_requested_alert+channelsTried+locationInstructions` — placeholders `{{1}}` = contactName, `{{2}}` = senderDisplayName, `{{3}}` = receiverName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions

| Language | SID map key | Text to submit |
| --- | --- | --- |
| English (en) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:en` | Hi {{1}}, this is Nearby. {{2}} asked us to alert you about {{3}} and would like you to check on them. We tried {{4}}. Where to find them: {{5}} Reply DONE once you have reached them. |
| Arabic (ar) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:ar` | مرحباً {{1}}، هذه رسالة من Nearby. بطلب من {{2}}، نرجو منك الاطمئنان على {{3}}. حاولنا عبر {{4}}. كيفية الوصول: {{5}} أرسل DONE بعد التواصل. |
| Spanish (es) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:es` | Hola {{1}}, le escribe Nearby. {{2}} nos pidió avisarle sobre {{3}} y le pide que compruebe que está bien. Lo intentamos por {{4}}. Ubicación: {{5}} Responda DONE cuando haya hablado con {{3}}. |
| Hindi (hi) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:hi` | नमस्ते {{1}}, यह Nearby है। {{2}} ने कहा है कि आपको {{3}} के बारे में सूचित करें; कृपया उनकी खैरियत पूछें। हमने {{4}} से कोशिश की। पता: {{5}} उनसे बात होने पर DONE लिखें। |
| Urdu (ur) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:ur` | محترم {{1}}، یہ Nearby ہے۔ {{2}} نے کہا ہے کہ آپ کو {{3}} کے بارے میں آگاہ کریں؛ براہ کرم ان کی خیریت دریافت کریں۔ ہم نے {{4}} سے کوشش کی۔ پتہ: {{5}} رابطہ ہو جانے پر DONE لکھیں۔ |
| Malayalam (ml) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:ml` | നമസ്കാരം {{1}}, ഇത് Nearby ആണ്. {{2}}-നെ കുറിച്ച് താങ്കളെ അറിയിക്കാൻ {{3}} ആവശ്യപ്പെട്ടു; ദയവായി അവരെ അന്വേഷിക്കുക. {{4}} വഴി ശ്രമിച്ചു. എവിടെ കാണാം: {{5}} അവരെ ബന്ധപ്പെട്ടാൽ DONE എന്ന് അയയ്ക്കുക.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Tamil (ta) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:ta` | வணக்கம் {{1}}, இது Nearby. {{2}} குறித்து உங்களுக்குத் தெரிவிக்க {{3}} கேட்டுள்ளார்; தயவுசெய்து அவரை விசாரிக்கவும். {{4}} மூலம் முயற்சித்தோம். இருப்பிடம்: {{5}} அவரைத் தொடர்பு கொண்டபின் DONE என்று அனுப்பவும்.<br>Numbering in this language: `{{1}}` = contactName, `{{2}}` = receiverName, `{{3}}` = senderDisplayName, `{{4}}` = channelsTried, `{{5}}` = locationInstructions |
| Bengali (bn) | `backup_contact_sender_requested_alert+channelsTried+locationInstructions:bn` | প্রিয় {{1}}, এটি Nearby। {{2}} বলেছেন {{3}} সম্পর্কে আপনাকে জানাতে; অনুগ্রহ করে তাঁর খবর নিন। আমরা {{4}}-এর মাধ্যমে চেষ্টা করেছি। ঠিকানা: {{5}} যোগাযোগ হলে DONE লিখুন। |

<!-- 112 templates generated from the seed migration -->