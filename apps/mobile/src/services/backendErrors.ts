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

export function isPaidAccessRequiredError(error: unknown): boolean {
  return (
    error instanceof BackendRequestError &&
    error.status === 403 &&
    (error.code === PAID_ACCESS_REQUIRED_CODE || error.message === PAID_ACCESS_REQUIRED_MESSAGE)
  );
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
          : 'You can resend once 7 days have passed since the last invitation.';
      }
      default:
        break;
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
