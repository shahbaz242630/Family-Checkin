/** The keywords the keypad can produce; `ReceiverReplyService.handleInboundReply` parses them like typed text. */
export type TwilioVoiceReplyKeyword = 'YES' | 'HELP' | 'STOP';

/**
 * Keypad digit -> reply keyword, as the recorded prompts announce them (docs/providers/twilio.md): 1 "I am okay"
 * (YES), 2 "I need help" (HELP), 9 "stop these calls" (STOP). REPORT has no digit: an abuse report needs a human
 * to read it, and the prompts do not offer it.
 */
export const TWILIO_VOICE_DIGIT_KEYWORDS: Readonly<Record<string, TwilioVoiceReplyKeyword>> = {
  '1': 'YES',
  '2': 'HELP',
  '9': 'STOP',
};

/**
 * What to hand the reply service for one `<Gather>` result, or `undefined` when nothing should be recorded: an
 * unmapped digit (`3`, `*`, `#`), an empty gather, or a blank transcript. Digits win over a transcript when Twilio
 * sends both. Our TwiML gathers DTMF only, so a `SpeechResult` is defensive: it is passed through trimmed for the
 * reply service's own keyword parser rather than mapped here.
 */
export function twilioVoiceReplyKeyword(input: { digits?: string; speechResult?: string }): string | undefined {
  const digits = input.digits?.trim();
  if (digits) {
    return TWILIO_VOICE_DIGIT_KEYWORDS[digits];
  }

  const transcript = input.speechResult?.trim();
  return transcript ? transcript : undefined;
}
