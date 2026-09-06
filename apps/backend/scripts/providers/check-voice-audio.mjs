#!/usr/bin/env node
// Checks that every recorded voice prompt the backend plays is reachable where Twilio will fetch it (CB-022):
//   ${VOICE_AUDIO_BASE_URL}/{language}/{scriptKey}.wav            (layout: src/modules/channels/twilio-rendering.ts)
//
//   VOICE_AUDIO_BASE_URL=https://cdn.example.com/voice npm run providers:check-voice-audio
//   npm run providers:check-voice-audio -- --base-url=https://cdn.example.com/voice --languages=en,ar
//
// Every URL is requested with HEAD (GET with a one-byte Range when the host refuses HEAD) and must answer 2xx with
// an audio/* content type: a CDN that answers 200 text/html for a missing file would otherwise break every call.
// Exit 0 when everything is present, 1 listing what is missing or not audio, 2 on a usage error.
//
// The script-key lists are asserted equal to TWILIO_VOICE_SCRIPT_KEYS by twilio-rendering.spec.ts: change both
// together. Receiver prompts are needed in every language a receiver can choose; the sender siren is played to the
// sender in English only (escalations.service.ts), so it is checked for "en" alone.
const RECEIVER_SCRIPT_KEYS = [
  'checkin_daily_voice',
  'consent_request_voice',
  'receiver_checkins_paused_voice',
  'receiver_checkins_ended_voice',
];
const SENDER_SCRIPT_KEYS = ['sender_escalation_siren_voice'];
const LANGUAGES = ['en', 'ar', 'es', 'hi', 'ur', 'ml', 'ta', 'bn'];
const DEFAULT_TIMEOUT_MS = 10_000;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { baseUrl: process.env.VOICE_AUDIO_BASE_URL, languages: LANGUAGES, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--languages=')) {
      options.languages = arg
        .slice('--languages='.length)
        .split(',')
        .map((language) => language.trim().toLowerCase())
        .filter((language) => language.length > 0);
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }

  options.baseUrl = (options.baseUrl ?? '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new UsageError('set VOICE_AUDIO_BASE_URL or pass --base-url=https://...');
  }
  const unknown = options.languages.filter((language) => !LANGUAGES.includes(language));
  if (options.languages.length === 0 || unknown.length > 0) {
    throw new UsageError(`--languages must be a subset of ${LANGUAGES.join(',')}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new UsageError('--timeout-ms must be a positive integer');
  }
  return options;
}

export function expectedAudioFiles(languages) {
  const files = [];
  for (const language of languages) {
    for (const scriptKey of RECEIVER_SCRIPT_KEYS) {
      files.push({ language, scriptKey, path: `${language}/${scriptKey}.wav` });
    }
  }
  if (languages.includes('en')) {
    for (const scriptKey of SENDER_SCRIPT_KEYS) {
      files.push({ language: 'en', scriptKey, path: `en/${scriptKey}.wav` });
    }
  }
  return files;
}

async function probe(url, timeoutMs) {
  let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if ([403, 405, 501].includes(response.status)) {
    response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => {});
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const length = response.headers.get('content-range')?.split('/')[1] ?? response.headers.get('content-length');
  return { status: response.status, contentType, length: length ? Number(length) : undefined };
}

export function classify(result) {
  if (result.error) return { ok: false, label: 'ERROR', detail: result.error };
  if (result.status < 200 || result.status >= 300)
    return { ok: false, label: 'MISSING', detail: `HTTP ${result.status}` };
  if (!result.contentType.startsWith('audio/')) {
    return {
      ok: false,
      label: 'NOT AUDIO',
      detail: `HTTP ${result.status} ${result.contentType || 'no content type'}`,
    };
  }
  return { ok: true, label: 'ok', detail: `${result.contentType}${result.length ? ` ${result.length} bytes` : ''}` };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = expectedAudioFiles(options.languages);
  console.log(`check-voice-audio -> ${options.baseUrl} (${files.length} files, ${options.languages.join(',')})`);

  const results = await Promise.all(
    files.map(async (file) => {
      const url = `${options.baseUrl}/${file.path}`;
      try {
        return { file, url, ...(await probe(url, options.timeoutMs)) };
      } catch (error) {
        return { file, url, status: 0, contentType: '', error: error?.message ?? String(error) };
      }
    }),
  );

  const failures = [];
  for (const result of results) {
    const verdict = classify(result);
    console.log(`  ${verdict.label.padEnd(9)} ${result.file.path.padEnd(42)} ${verdict.detail}`);
    if (!verdict.ok) failures.push(result);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${files.length} prompt files are missing or not audio:`);
    for (const failure of failures) {
      console.error(`  ${failure.url}`);
    }
    process.exit(1);
  }
  console.log(`\nall ${files.length} prompt files present`);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`check-voice-audio: ${error.message}`);
    console.error(
      'usage: node scripts/providers/check-voice-audio.mjs [--base-url=https://...] [--languages=en,ar,...] [--timeout-ms=10000]',
    );
    process.exit(2);
  }
  console.error(`check-voice-audio failed: ${error.message}`);
  process.exit(1);
});
