/**
 * A non-2xx answer from the Twilio REST API (CB-019). Twilio's JSON error body carries `code` (a Twilio error
 * number such as 21211), `message`, `more_info` (the docs page for that code) and `status` (the HTTP status).
 *
 * The error keeps the code, the HTTP status and the docs URL and deliberately drops Twilio's `message`: it quotes
 * request values ("The 'To' number +9715… is not a valid phone number") and an `Error.message` here ends up in
 * audit metadata and attempt rows, which must stay free of phone numbers and bodies.
 */
export class TwilioRequestError extends Error {
  override readonly name = 'TwilioRequestError';

  constructor(
    /** HTTP status of the Twilio response. */
    readonly status: number,
    /** Twilio error code (https://www.twilio.com/docs/api/errors), when the body carried one. */
    readonly code?: number,
    /** Twilio's `more_info` docs URL for the code, when present. */
    readonly moreInfo?: string,
  ) {
    super(describeTwilioFailure(status, code, moreInfo));
  }

  /** `twilio_<code>` (for example `twilio_21211`), or `twilio_http_<status>` when Twilio sent no code. */
  get failureReason(): string {
    return twilioFailureReason(this.status, this.code);
  }
}

export function twilioFailureReason(status: number, code: number | undefined): string {
  return code === undefined ? `twilio_http_${status}` : `twilio_${code}`;
}

/**
 * Builds the error for a failed Twilio response from whatever the body parsed to. Twilio sends `code` as a
 * number, but a numeric string is tolerated; anything else counts as "no code". A body that is not Twilio's
 * error shape (an HTML 502 from a proxy, an empty body) yields `twilio_http_<status>`.
 */
export function twilioRequestErrorFromResponse(status: number, payload: unknown): TwilioRequestError {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const code = numericCode(body.code);
  const moreInfo =
    typeof body.more_info === 'string' && body.more_info.startsWith('https://') ? body.more_info : undefined;

  return new TwilioRequestError(status, code, moreInfo);
}

function numericCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function describeTwilioFailure(status: number, code: number | undefined, moreInfo: string | undefined): string {
  const reason = code === undefined ? `HTTP ${status}` : `HTTP ${status}, error code ${code}`;
  return moreInfo ? `Twilio request failed (${reason}, see ${moreInfo})` : `Twilio request failed (${reason})`;
}
