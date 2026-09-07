export const PAID_ACCESS_REQUIRED_MESSAGE = 'Active subscription required to add receivers';
export const PAID_ACCESS_REQUIRED_CODE = 'PAID_ACCESS_REQUIRED';

/**
 * Typed refusals from the receivers API. Each arrives as `{ code, message, ...details }` on a 409 or 429; the
 * details carry the date the sender is waiting for (`cooldownUntil`, `nextAllowedAt`). See
 * `docs/handoffs/receivers-and-consent.md`.
 */
export const OPT_OUT_COOLDOWN_CODE = 'OPT_OUT_COOLDOWN';
export const RECEIVER_ALREADY_MONITORED_CODE = 'RECEIVER_ALREADY_MONITORED';
export const CHECK_IN_IN_PROGRESS_CODE = 'CHECK_IN_IN_PROGRESS';
export const CONSENT_NOT_PENDING_CODE = 'CONSENT_NOT_PENDING';
export const CONSENT_RESEND_LIMIT_CODE = 'CONSENT_RESEND_LIMIT';
/**
 * A 401 that means "the session is fine, the account has no usable phone number yet" (CB-037). Without it the
 * app could not tell this from an expired or forged token and signed the sender out; with it the app sends them
 * to the profile screen. The backend puts it on both the missing and the unparseable phone.
 */
export const PHONE_REQUIRED_CODE = 'PHONE_REQUIRED';

export class BackendRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    /** Every other field of the error body (`cooldownUntil`, `nextAllowedAt`, …); never `message` or `code`. */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BackendRequestError';
  }
}

/** A 2xx whose body never arrived: the server acted on the request, the reply did not come through whole (CB-080). */
export const EMPTY_RESPONSE_MESSAGE =
  'The reply from the server did not arrive in full. Check the screen and try again if needed.';
/** A 2xx whose body is not the JSON the app expected (CB-080). */
export const UNREADABLE_RESPONSE_MESSAGE = 'The reply from the server could not be read. Please try again.';
/** The request was still unanswered after `REQUEST_TIMEOUT_MS` and was aborted (CB-037). */
export const REQUEST_TIMEOUT_MESSAGE = 'The server took too long to answer. Check your connection and try again.';
/** A throttled request: Nest answers "ThrottlerException: Too many requests", which is not sender copy (CB-037). */
export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests just now. Wait a moment and try again.';
/** What the sender is told when the account has no phone number yet; the screen sends them to Profile (CB-037). */
export const PHONE_REQUIRED_MESSAGE =
  'Add your phone number in Profile. Nearby needs it to reach you when a check-in needs attention.';
/** A 401 that is a real authentication failure: the session cannot be used again (CB-037). */
export const SESSION_EXPIRED_MESSAGE = 'Your session has ended. Sign in again to continue.';

/**
 * The request reached the backend and was answered with a success status, but the body was missing or unreadable
 * (sprint-2 acceptance F2). Idempotent reads are retried once on it; anything else surfaces the message as is.
 */
export class BackendTransportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: 'empty_body' | 'unreadable_body' | 'timeout',
  ) {
    super(message);
    this.name = 'BackendTransportError';
  }
}

export function isPaidAccessRequiredError(error: unknown): boolean {
  return (
    error instanceof BackendRequestError &&
    error.status === 403 &&
    (error.code === PAID_ACCESS_REQUIRED_CODE || error.message === PAID_ACCESS_REQUIRED_MESSAGE)
  );
}

/** The request was aborted by the client's own 15-second deadline rather than answered (CB-037). */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof BackendTransportError && error.reason === 'timeout';
}

/**
 * What a 401 asks the app to do (CB-037). `add-phone` is the account that has never had a usable phone number:
 * the session is valid and signing the sender out would strand them, so the screen sends them to Profile.
 * `sign-out` is every other 401 — expired, forged, wrong project. Anything else is not an auth failure at all.
 */
export type AuthFailureAction = 'sign-out' | 'add-phone';

export function authFailureAction(error: unknown): AuthFailureAction | null {
  if (!(error instanceof BackendRequestError) || error.status !== 401) {
    return null;
  }

  return error.code === PHONE_REQUIRED_CODE ? 'add-phone' : 'sign-out';
}

export function isPhoneRequiredError(error: unknown): boolean {
  return authFailureAction(error) === 'add-phone';
}

/** The backend answered 404: the receiver, contact or check-in acted on no longer exists (removed or superseded). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof BackendRequestError && error.status === 404;
}

/** The backend's machine-readable `code`, when the failure is a `BackendRequestError` that carried one. */
export function backendErrorCode(error: unknown): string | undefined {
  return error instanceof BackendRequestError ? error.code : undefined;
}

export function isBackendErrorCode(error: unknown, code: string): boolean {
  return backendErrorCode(error) === code;
}

export interface DescribeBackendErrorOptions {
  /** Formats an ISO timestamp from the error details for display; defaults to the device locale. */
  formatDate?: (isoDate: string) => string;
}

/**
 * Human copy for a failed backend call. The typed refusals above get a sentence that says what to do next,
 * with the date from their details; anything else falls back to the backend's own message, then to `fallback`.
 */
export function describeBackendError(
  error: unknown,
  fallback: string,
  options: DescribeBackendErrorOptions = {},
): string {
  const formatDate = options.formatDate ?? formatBackendDate;

  if (error instanceof BackendRequestError) {
    switch (error.code) {
      case OPT_OUT_COOLDOWN_CODE: {
        const until = detailDate(error.details, 'cooldownUntil', formatDate);
        return until
          ? `This person opted out recently; you can invite them again after ${until}.`
          : 'This person opted out recently; you can invite them again once their opt-out cooldown ends.';
      }
      case RECEIVER_ALREADY_MONITORED_CODE:
        return 'This phone number already receives Nearby check-ins from another account.';
      case CHECK_IN_IN_PROGRESS_CODE:
        return 'A check-in is still in progress for this receiver. Wait for it to finish before trying again.';
      case CONSENT_NOT_PENDING_CODE:
        return 'This receiver has already answered the invitation, so it cannot be resent.';
      case CONSENT_RESEND_LIMIT_CODE: {
        const next = detailDate(error.details, 'nextAllowedAt', formatDate);
        return next
          ? `You can resend on ${next}.`
          : 'The invitation was sent recently. You can resend it once the waiting period has passed.';
      }
      case PHONE_REQUIRED_CODE:
        return PHONE_REQUIRED_MESSAGE;
      default:
        break;
    }

    // Throttling has no code of its own; the raw body is Nest's "ThrottlerException: Too many requests" (CB-037).
    if (error.status === 429) {
      return TOO_MANY_REQUESTS_MESSAGE;
    }
    if (error.status === 401) {
      return SESSION_EXPIRED_MESSAGE;
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

/** Locale date and time for an ISO timestamp; the raw value when it does not parse. */
export function formatBackendDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function detailDate(
  details: Record<string, unknown>,
  key: string,
  formatDate: (isoDate: string) => string,
): string | undefined {
  const value = details[key];
  return typeof value === 'string' && value ? formatDate(value) : undefined;
}
