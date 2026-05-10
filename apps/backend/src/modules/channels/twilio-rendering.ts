import type { TemplatedMessage, VoiceScript } from './channel-provider';

export function renderTwilioMessage(message: TemplatedMessage): string {
  const variables = Object.entries(message.variables)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`);

  return [message.templateKey, ...variables].join('\n');
}

export function renderTwilioVoiceTwiml(
  script: VoiceScript,
  options: {
    actionUrl: string;
    audioBaseUrl: string;
  },
): string {
  const audioUrl = `${options.audioBaseUrl}/${languagePath(script.language)}/${audioFileName(script.scriptKey)}.wav`;
  const gather = `<Gather input="dtmf" numDigits="1" timeout="10" action="${escapeXml(
    options.actionUrl,
  )}" method="POST"><Play>${escapeXml(audioUrl)}</Play></Gather>`;

  return `<Response>${gather}${gather}<Hangup/></Response>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function languagePath(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === 'ar' || normalized.startsWith('ar-')) {
    return 'ar';
  }
  if (normalized === 'es' || normalized.startsWith('es-')) {
    return 'es';
  }
  if (normalized === 'hi' || normalized.startsWith('hi-')) {
    return 'hi';
  }
  if (normalized === 'ur' || normalized.startsWith('ur-')) {
    return 'ur';
  }

  return 'en';
}

function audioFileName(scriptKey: string): string {
  return scriptKey.replace(/[^a-zA-Z0-9_-]/g, '');
}
