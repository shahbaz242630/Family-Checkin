import type { VoiceScript } from './channel-provider';

/** Languages with a folder of recorded prompts under `VOICE_AUDIO_BASE_URL`: the eight BRD launch languages. */
export const VOICE_AUDIO_LANGUAGES = ['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn'] as const;
export type VoiceAudioLanguage = (typeof VOICE_AUDIO_LANGUAGES)[number];

/**
 * Every `scriptKey` the backend plays, which is every file the audio hosting must provide per language folder as
 * `${VOICE_AUDIO_BASE_URL}/{language}/{scriptKey}.wav`. `scripts/providers/check-voice-audio.mjs` carries the same
 * list (asserted equal by `twilio-rendering.spec.ts`, which also scans the callers for `*_voice` keys) and
 * docs/providers/twilio.md describes what each recording says. Voice attempts after the first play
 * `checkin_daily_voice` again: there is no `checkin_retry_voice`. `sender_escalation_siren_voice` is played to the
 * sender, in English only (`escalations.service.ts`).
 */
export const TWILIO_VOICE_SCRIPT_KEYS = [
  'checkin_daily_voice',
  'consent_request_voice',
  'receiver_checkins_paused_voice',
  'receiver_checkins_ended_voice',
  'sender_escalation_siren_voice',
] as const;

/** Route of the `<Gather>` action; `ProviderWebhooksController` verifies the Twilio signature over it. */
export const TWILIO_VOICE_GATHER_ACTION_PATH = '/provider-webhooks/twilio/voice' as const;
/** Query parameter of the action URL that carries the receiver's language (Twilio's POST body has none). */
export const TWILIO_VOICE_LANGUAGE_QUERY_PARAM = 'lang';

/** `ar-EG` -> `ar`, `EN` -> `en`; anything outside the eight launch languages -> `en`. */
export function voiceAudioLanguage(language: string): VoiceAudioLanguage {
  const normalized = language.trim().toLowerCase();
  const base = normalized.split(/[-_]/)[0] ?? normalized;
  return (VOICE_AUDIO_LANGUAGES as readonly string[]).includes(base) ? (base as VoiceAudioLanguage) : 'en';
}

export function voiceAudioFileName(scriptKey: string): string {
  return `${scriptKey.replace(/[^a-zA-Z0-9_-]/g, '')}.wav`;
}

export function voiceAudioUrl(audioBaseUrl: string, language: string, scriptKey: string): string {
  return `${stripTrailingSlash(audioBaseUrl)}/${voiceAudioLanguage(language)}/${voiceAudioFileName(scriptKey)}`;
}

export function twilioVoiceGatherActionUrl(publicApiBaseUrl: string, language: string): string {
  const query = new URLSearchParams({ [TWILIO_VOICE_LANGUAGE_QUERY_PARAM]: voiceAudioLanguage(language) });
  return `${stripTrailingSlash(publicApiBaseUrl)}${TWILIO_VOICE_GATHER_ACTION_PATH}?${query.toString()}`;
}

/**
 * The TwiML handed to Twilio's Calls API for an outbound call: the recorded prompt inside a one-digit `<Gather>`,
 * played twice for a receiver who pressed nothing the first time, then hang up. The prompt is hosted audio rather
 * than `<Say>` so native speakers can review and re-record it (decision 3); the receiver's language picks the
 * folder and rides along to the Gather action, which speaks the thank-you in the same language.
 */
export function renderTwilioVoiceTwiml(
  script: VoiceScript,
  options: {
    publicApiBaseUrl: string;
    audioBaseUrl: string;
  },
): string {
  const audioUrl = voiceAudioUrl(options.audioBaseUrl, script.language, script.scriptKey);
  const actionUrl = twilioVoiceGatherActionUrl(options.publicApiBaseUrl, script.language);
  const gather = `<Gather input="dtmf" numDigits="1" timeout="10" action="${escapeXml(
    actionUrl,
  )}" method="POST"><Play>${escapeXml(audioUrl)}</Play></Gather>`;

  return `<Response>${gather}${gather}<Hangup/></Response>`;
}

interface SpokenReply {
  /** Twilio `<Say language>` code. */
  language: string;
  /** A Standard-tier voice that supports `language` (https://www.twilio.com/docs/voice/twiml/say/text-speech). */
  voice: string;
  text: string;
}

/**
 * The thank-you Twilio speaks after a keypress, per launch language (CB-022). Twilio offers no Urdu voice (neither
 * Google nor Amazon Polly has one), so `ur` is spoken by the Hindi voice reading the same plain Hindustani sentence
 * written in Devanagari: for a sentence this simple, spoken Urdu and Hindi are the same language. Anything outside
 * the eight languages is spoken in English. Every non-English sentence is a machine translation, unreviewed
 * (docs/handoffs/message-copy-review.md); the same sentence is used whatever digit was pressed.
 */
export const TWILIO_VOICE_REPLY_SAY: Readonly<Record<VoiceAudioLanguage, SpokenReply>> = {
  en: { language: 'en-GB', voice: 'Polly.Amy', text: 'Thank you. Your answer has been received. Goodbye.' },
  ar: { language: 'ar-XA', voice: 'Google.ar-XA-Standard-A', text: 'شكراً لك. تم استلام ردك. مع السلامة.' },
  es: { language: 'es-ES', voice: 'Google.es-ES-Standard-A', text: 'Gracias. Hemos recibido su respuesta. Adiós.' },
  hi: { language: 'hi-IN', voice: 'Google.hi-IN-Standard-A', text: 'धन्यवाद। आपका जवाब मिल गया है। नमस्ते।' },
  ur: { language: 'hi-IN', voice: 'Google.hi-IN-Standard-A', text: 'शुक्रिया। आपका जवाब मिल गया है। ख़ुदा हाफ़िज़।' },
  ml: { language: 'ml-IN', voice: 'Google.ml-IN-Standard-A', text: 'നന്ദി. താങ്കളുടെ മറുപടി ലഭിച്ചു. നമസ്കാരം.' },
  ta: { language: 'ta-IN', voice: 'Google.ta-IN-Standard-A', text: 'நன்றி. உங்கள் பதில் கிடைத்தது. வணக்கம்.' },
  bn: { language: 'bn-IN', voice: 'Google.bn-IN-Standard-A', text: 'ধন্যবাদ। আপনার উত্তর পাওয়া গেছে। ভালো থাকবেন।' },
};

/**
 * The `200 text/xml` body of the Gather action: say thank you in the receiver's language and hang up. Returned for
 * every keypress, mapped or not, so an unexpected digit ends politely instead of with Twilio's error tone.
 */
export function renderTwilioVoiceReplyTwiml(language: string): string {
  const say = TWILIO_VOICE_REPLY_SAY[voiceAudioLanguage(language)];

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Say language="${escapeXml(say.language)}" voice="${escapeXml(say.voice)}">${escapeXml(
      say.text,
    )}</Say><Hangup/></Response>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
