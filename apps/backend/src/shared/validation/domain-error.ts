/**
 * Domain failures that are the caller's fault, carried to the HTTP layer with a stable machine-readable `code`
 * (CB-042). Before this, "a receiver can have at most 5 active backup contacts" and "A valid Expo push token is
 * required" were plain `Error`s: the app saw a 500 with no way to tell a rule from an outage.
 *
 * The code is part of the API contract — the mobile app switches on it (`describeBackendError`) — so codes are
 * renamed only with the app.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** The response body: `{ code, message }` plus whatever the failure needs to be actionable. */
  toResponseBody(): Record<string, string> {
    return { code: this.code, message: this.message, ...this.details };
  }
}

/** 400: the request said something the domain cannot accept, past what the body schema can express. */
export class InvalidRequestError extends DomainError {
  constructor(code: string, message: string, details: Record<string, string> = {}) {
    super(code, message, 400, details);
  }
}
