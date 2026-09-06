import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TWILIO_VOICE_REPLY_SAY,
  TWILIO_VOICE_SCRIPT_KEYS,
  VOICE_AUDIO_LANGUAGES,
  renderTwilioVoiceReplyTwiml,
  renderTwilioVoiceTwiml,
  twilioVoiceGatherActionUrl,
  voiceAudioLanguage,
  voiceAudioUrl,
} from './twilio-rendering';

const BACKEND_ROOT = resolve(__dirname, '../../..');
const CHECK_VOICE_AUDIO_SCRIPT = resolve(BACKEND_ROOT, 'scripts/providers/check-voice-audio.mjs');
/** Every backend file that asks the router for a voice call. */
const VOICE_CALLERS = [
  'src/modules/check-ins/check-ins.service.ts',
  'src/modules/receivers/receivers.service.ts',
  'src/modules/receivers/receiver-consent.service.ts',
  'src/modules/receivers/receiver-reply.service.ts',
  'src/modules/escalations/escalations.service.ts',
];

/** The string entries of `const <name> = [...]` in the check script. */
function listLiteral(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  if (!match) {
    throw new Error(`${name} not found in check-voice-audio.mjs`);
  }
  return (match[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter((entry) => entry.length > 0);
}

describe('voice audio layout (CB-022)', () => {
  it.each([
    ['en', 'en'],
    ['ar', 'ar'],
    ['es', 'es'],
    ['hi', 'hi'],
    ['ur', 'ur'],
    ['ml', 'ml'],
    ['ta', 'ta'],
    ['bn', 'bn'],
    ['ar-EG', 'ar'],
    ['es_MX', 'es'],
    [' EN-GB ', 'en'],
    ['fr-CA', 'en'],
    ['tl', 'en'],
    ['', 'en'],
  ])('maps receiver language %j to the %s audio folder', (language, folder) => {
    expect(voiceAudioLanguage(language)).toBe(folder);
  });

  it('builds the prompt URL from the base URL, the language folder and the script key', () => {
    expect(voiceAudioUrl('https://cdn.nearby.test/voice/', 'ta', 'checkin_daily_voice')).toBe(
      'https://cdn.nearby.test/voice/ta/checkin_daily_voice.wav',
    );
    expect(voiceAudioUrl('https://cdn.nearby.test/voice', 'xx', 'weird/../key')).toBe(
      'https://cdn.nearby.test/voice/en/weirdkey.wav',
    );
  });

  it('lists exactly the script keys the callers use', () => {
    const used = new Set<string>();
    for (const relativePath of VOICE_CALLERS) {
      const source = readFileSync(resolve(BACKEND_ROOT, relativePath), 'utf8');
      for (const match of source.matchAll(/'([a-z_]+_voice)'/g)) {
        used.add(match[1] ?? '');
      }
    }

    expect([...used].sort()).toEqual([...TWILIO_VOICE_SCRIPT_KEYS].sort());
  });

  it('keeps scripts/providers/check-voice-audio.mjs on the same script keys and languages', () => {
    const script = readFileSync(CHECK_VOICE_AUDIO_SCRIPT, 'utf8');
    const scriptKeys = [...listLiteral(script, 'RECEIVER_SCRIPT_KEYS'), ...listLiteral(script, 'SENDER_SCRIPT_KEYS')];

    expect(scriptKeys.sort()).toEqual([...TWILIO_VOICE_SCRIPT_KEYS].sort());
    expect(listLiteral(script, 'SENDER_SCRIPT_KEYS')).toEqual(['sender_escalation_siren_voice']);
    expect(listLiteral(script, 'LANGUAGES')).toEqual([...VOICE_AUDIO_LANGUAGES]);
  });
});

describe('renderTwilioVoiceTwiml', () => {
  it('plays the prompt twice inside a one-digit Gather whose action carries the language, then hangs up', () => {
    const twiml = renderTwilioVoiceTwiml(
      { scriptKey: 'consent_request_voice', language: 'ar', variables: {} },
      { publicApiBaseUrl: 'https://api.nearby.test/', audioBaseUrl: 'https://cdn.nearby.test/voice/' },
    );

    const gather =
      '<Gather input="dtmf" numDigits="1" timeout="10" action="https://api.nearby.test/provider-webhooks/twilio/voice?lang=ar" method="POST">' +
      '<Play>https://cdn.nearby.test/voice/ar/consent_request_voice.wav</Play></Gather>';
    expect(twiml).toBe(`<Response>${gather}${gather}<Hangup/></Response>`);
  });

  it('sends unknown languages to the English folder and the English thank-you', () => {
    expect(twilioVoiceGatherActionUrl('https://api.nearby.test', 'fr-CA')).toBe(
      'https://api.nearby.test/provider-webhooks/twilio/voice?lang=en',
    );
  });
});

describe('renderTwilioVoiceReplyTwiml', () => {
  it('speaks the thank-you in the receiver language with a voice that supports it and hangs up', () => {
    const twiml = renderTwilioVoiceReplyTwiml('ar');

    expect(twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ar-XA" voice="Google.ar-XA-Standard-A">' +
        'شكراً لك. تم استلام ردك. مع السلامة.</Say><Hangup/></Response>',
    );
  });

  it('falls back to English for a missing or unsupported language', () => {
    const english = renderTwilioVoiceReplyTwiml('en');

    expect(english).toContain(
      '<Say language="en-GB" voice="Polly.Amy">Thank you. Your answer has been received. Goodbye.</Say>',
    );
    expect(renderTwilioVoiceReplyTwiml('')).toBe(english);
    expect(renderTwilioVoiceReplyTwiml('fr')).toBe(english);
  });

  it('has a spoken reply for every audio language, each in its own script and free of XML-significant characters', () => {
    for (const language of VOICE_AUDIO_LANGUAGES) {
      const say = TWILIO_VOICE_REPLY_SAY[language];
      const twiml = renderTwilioVoiceReplyTwiml(language);

      expect(say.text, language).not.toMatch(/[<>&"']/);
      expect(say.voice, language).toMatch(/^(Polly|Google)\./);
      expect(twiml, language).toContain(`language="${say.language}"`);
      expect(twiml, language).toContain(`>${say.text}</Say><Hangup/></Response>`);
    }
    expect(TWILIO_VOICE_REPLY_SAY.ar.text).toMatch(/\p{Script=Arabic}/u);
    expect(TWILIO_VOICE_REPLY_SAY.hi.text).toMatch(/\p{Script=Devanagari}/u);
    // Twilio has no Urdu voice: Hindustani in Devanagari, spoken by the Hindi voice.
    expect(TWILIO_VOICE_REPLY_SAY.ur.language).toBe('hi-IN');
    expect(TWILIO_VOICE_REPLY_SAY.ur.text).toMatch(/\p{Script=Devanagari}/u);
    expect(TWILIO_VOICE_REPLY_SAY.ml.text).toMatch(/\p{Script=Malayalam}/u);
    expect(TWILIO_VOICE_REPLY_SAY.ta.text).toMatch(/\p{Script=Tamil}/u);
    expect(TWILIO_VOICE_REPLY_SAY.bn.text).toMatch(/\p{Script=Bengali}/u);
  });
});
