// Post-purchase entitlement polling (CB-041).
//
// A store purchase is confirmed to Nearby by a RevenueCat webhook, so the
// backend's `/billing/status` only turns `entitled` some seconds after the
// purchase sheet closes. Without polling the screen keeps saying "No active
// subscription" until the sender leaves and comes back, which reads as a failed
// purchase. This module has no React and no native imports so it can be tested
// with plain vitest.

/** The sender should not have to wait longer than this before we say so plainly. */
export const BILLING_POLL_TIMEOUT_MS = 60_000;
export const BILLING_POLL_INTERVAL_MS = 3_000;

export interface BillingPollOptions<TStatus> {
  fetchStatus: () => Promise<TStatus>;
  isEntitled: (status: TStatus) => boolean;
  /** Injected so tests do not spend real time; the screen passes setTimeout. */
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** Called after every successful fetch so the screen can render as it polls. */
  onStatus?: (status: TStatus) => void;
  /** Stops the loop early — the screen passes "has this screen unmounted?". */
  isCancelled?: () => boolean;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface BillingPollResult<TStatus> {
  /** The last status that was read, or null when every attempt failed. */
  status: TStatus | null;
  entitled: boolean;
  /** True when the deadline passed without entitlement. */
  timedOut: boolean;
  cancelled: boolean;
  attempts: number;
  /** The last fetch failure, kept so the screen can explain a total outage. */
  lastError: unknown;
}

/**
 * Reads billing status until it says entitled, the deadline passes, or the
 * caller cancels. A failing fetch does not end the poll: the store webhook may
 * still be in flight, so it retries until the deadline and reports the last
 * error only if nothing ever succeeded.
 */
export async function pollBillingStatusUntilEntitled<TStatus>(
  options: BillingPollOptions<TStatus>,
): Promise<BillingPollResult<TStatus>> {
  const timeoutMs = options.timeoutMs ?? BILLING_POLL_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? BILLING_POLL_INTERVAL_MS;
  const deadline = options.now() + timeoutMs;

  let status: TStatus | null = null;
  let lastError: unknown = null;
  let attempts = 0;

  for (;;) {
    if (options.isCancelled?.()) {
      return { status, entitled: false, timedOut: false, cancelled: true, attempts, lastError };
    }

    attempts += 1;

    try {
      const current = await options.fetchStatus();
      status = current;
      lastError = null;
      options.onStatus?.(current);

      if (options.isEntitled(current)) {
        return { status: current, entitled: true, timedOut: false, cancelled: false, attempts, lastError: null };
      }
    } catch (error) {
      lastError = error;
    }

    if (options.isCancelled?.()) {
      return { status, entitled: false, timedOut: false, cancelled: true, attempts, lastError };
    }

    // Only sleep when another attempt still fits inside the deadline.
    if (options.now() + intervalMs >= deadline) {
      return { status, entitled: false, timedOut: true, cancelled: false, attempts, lastError };
    }

    await options.wait(intervalMs);
  }
}
