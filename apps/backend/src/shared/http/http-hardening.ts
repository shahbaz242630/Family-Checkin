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
  const trustProxy = config.trustProxy;
  if (trustProxy !== undefined) {
    // Required behind a load balancer / reverse proxy so req.ip (used by the rate limiter)
    // reflects the real client instead of the proxy.
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.use(helmet());
  app.enableCors(corsOptionsFromConfig(config));
}
