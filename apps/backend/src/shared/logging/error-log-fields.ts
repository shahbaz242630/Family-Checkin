/**
 * The log fields for a caught error (CB-047). Only the error's own name, its message and — for a provider
 * rejection — the numeric provider error code. Nothing that could be PII: `TwilioRequestError` deliberately drops
 * Twilio's own `message` because it quotes the phone number it rejected (CB-019), and no other error in the
 * backend puts a person's data in `message`.
 *
 * `providerErrorCode` is read structurally rather than by importing `TwilioRequestError`, so `shared/` keeps no
 * dependency on a provider module.
 */
export interface ErrorLogFields {
  error: string;
  errorName: string;
  providerErrorCode?: number;
}

const MAX_ERROR_LENGTH = 300;

export function errorLogFields(error: unknown): ErrorLogFields {
  const fields: ErrorLogFields = {
    error: errorMessage(error),
    errorName: error instanceof Error ? error.name : typeof error,
  };
  const providerErrorCode = providerErrorCodeOf(error);
  if (providerErrorCode !== undefined) {
    fields.providerErrorCode = providerErrorCode;
  }

  return fields;
}

/** The provider's numeric error code (Twilio's `code`, for example 21606) when the error carries one. */
export function providerErrorCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}
