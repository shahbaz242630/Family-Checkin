import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import helmet from 'helmet';
import type { AppConfigService } from '../config/app-config.service';

export type HttpHardeningConfig = Pick<
  AppConfigService,
  'rateLimitTtlSeconds' | 'rateLimitMaxRequests' | 'trustProxy' | 'corsAllowedOrigins'
>;

// Expo / Metro dev servers and the local web preview bind to 80xx ports.
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):80\d\d$/;

/**
 * Idle keep-alive must outlast the client's connection-reuse window. The Android app talks through OkHttp, whose
 * pool keeps an idle connection for 5 minutes; Node's default is 5 seconds, so the app could send on a socket the
 * server was closing and read an empty body for a request the server had executed (sprint-2 acceptance F2, CB-080).
 */
export const KEEP_ALIVE_TIMEOUT_MS = 305_000;
/** Node guidance: headersTimeout must exceed keepAliveTimeout, or idle keep-alive sockets are cut mid-request. */
export const HEADERS_TIMEOUT_MS = 310_000;
/** Whole-request cap, at least headersTimeout so the header budget is never cut short. */
export const REQUEST_TIMEOUT_MS = 320_000;

export interface ServerTimeouts {
  keepAliveTimeout: number;
  headersTimeout: number;
  requestTimeout: number;
}

export function applyServerTimeouts(server: ServerTimeouts): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
}

/**
 * Every API response is per-user JSON: never cached by a client or an intermediary, and never answered
 * conditionally (Express ETag / 304), so a client never renders a stale or empty body (CB-080).
 */
export function noStoreCacheControl(
  _request: unknown,
  response: { setHeader(name: string, value: string): unknown },
  next: () => void,
): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

export function throttlerOptionsFromConfig(
  config: Pick<HttpHardeningConfig, 'rateLimitTtlSeconds' | 'rateLimitMaxRequests'>,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: config.rateLimitTtlSeconds * 1000,
        limit: config.rateLimitMaxRequests,
      },
    ],
  };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  // Native mobile clients and server-to-server callers send no Origin header.
  if (!origin) {
    return true;
  }

  if (LOCAL_DEV_ORIGIN.test(origin)) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

export function corsOptionsFromConfig(config: Pick<HttpHardeningConfig, 'corsAllowedOrigins'>): CorsOptions {
  const allowedOrigins = config.corsAllowedOrigins;

  return {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  };
}

export function applyHttpHardening(app: INestApplication, config: HttpHardeningConfig): void {
  const express = app.getHttpAdapter().getInstance();
  const trustProxy = config.trustProxy;
  if (trustProxy !== undefined) {
    // Required behind a load balancer / reverse proxy so req.ip (used by the rate limiter)
    // reflects the real client instead of the proxy.
    express.set('trust proxy', trustProxy);
  }
  express.set('etag', false);

  app.use(noStoreCacheControl);
  app.use(helmet());
  app.enableCors(corsOptionsFromConfig(config));
  applyServerTimeouts(app.getHttpServer() as ServerTimeouts);
}
