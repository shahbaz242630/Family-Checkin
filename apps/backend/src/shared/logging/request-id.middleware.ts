import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Only a UUID is taken from the caller. An arbitrary inbound string would end up in every log line for that
 * request, and a client is free to put anything in a header, so anything that is not a UUID is replaced with a
 * fresh one — the id can then never carry a phone number or a name (BRD-8.7, CB-047). A proxy or load balancer
 * that stamps UUID request ids still correlates end to end.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestWithHeaders {
  headers?: Record<string, string | string[] | undefined>;
}

export interface ResponseWithHeaders {
  setHeader(name: string, value: string): unknown;
}

export function requestIdFromHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== 'string') {
    return undefined;
  }

  const trimmed = header.trim();
  return UUID.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

/**
 * First middleware in the chain: every log line written while this request is handled carries its `requestId`,
 * and the caller gets the same id back in `x-request-id` so a support report can be traced to its log lines.
 */
export function requestIdMiddleware(
  request: RequestWithHeaders,
  response: ResponseWithHeaders,
  next: () => void,
): void {
  const requestId = requestIdFromHeader(request.headers?.[REQUEST_ID_HEADER]) ?? randomUUID();
  response.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext({ requestId }, next);
}
