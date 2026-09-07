import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request data every log line written while handling that request picks up (CB-047). It holds an opaque id
 * and nothing else: no user id, no receiver id, no phone number, no body.
 */
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `callback` (and everything it awaits) with `context` attached to the async call chain. */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** The current request's id, or `undefined` outside a request (the scheduler tick's own work, boot, shutdown). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
