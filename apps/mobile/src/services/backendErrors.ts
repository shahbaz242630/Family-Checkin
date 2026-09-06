export const PAID_ACCESS_REQUIRED_MESSAGE = 'Active subscription required to add receivers';
export const PAID_ACCESS_REQUIRED_CODE = 'PAID_ACCESS_REQUIRED';

export class BackendRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
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
