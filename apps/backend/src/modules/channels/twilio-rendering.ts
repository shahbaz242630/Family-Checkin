import type { TemplatedMessage, VoiceScript } from './channel-provider';

export function renderTwilioMessage(message: TemplatedMessage): string {
  const variables = Object.entries(message.variables)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`);

  return [message.templateKey, ...variables].join('\n');
}

export function renderTwilioVoiceTwiml(script: VoiceScript, actionUrl: string): string {
  return `<Response><Gather input="dtmf speech" numDigits="1" action="${escapeXml(actionUrl)}" method="POST"><Say>${escapeXml(
    script.scriptKey,
  )}</Say></Gather></Response>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
