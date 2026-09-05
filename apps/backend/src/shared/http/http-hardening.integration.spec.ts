import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/app-config.service';
import { applyHttpHardening, throttlerOptionsFromConfig } from './http-hardening';

const ALLOWED_ORIGIN = 'https://admin.nearby.test';

const config = new AppConfigService({
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
  KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  SUPABASE_URL: 'https://nearby-test-project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OPERATIONS_CRON_SECRET: 'operations-cron-secret',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX_REQUESTS: '3',
  CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
});

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

// Mirrors the provider-webhook and operations controllers, which opt out of throttling.
@SkipThrottle()
@Controller('machine')
class MachineController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot(throttlerOptionsFromConfig(config))],
  controllers: [PingController, MachineController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class HardeningTestModule {}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, { headers });
  // Drain the body so the connection is released before the next request.
  await response.text();
  return response;
}

describe('applyHttpHardening (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HardeningTestModule, { logger: false });
    applyHttpHardening(app, config);
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 once the default throttler limit is exceeded', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await get(`${baseUrl}/ping`);
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('never throttles @SkipThrottle() controllers', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await get(`${baseUrl}/machine`);
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  it('applies helmet security headers and strips x-powered-by', async () => {
    const response = await get(`${baseUrl}/machine`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('x-powered-by')).toBe(false);
  });

  it('reflects listed CORS origins with credentials', async () => {
    const response = await get(`${baseUrl}/machine`, { origin: ALLOWED_ORIGIN });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('does not grant CORS to unlisted origins', async () => {
    const response = await get(`${baseUrl}/machine`, { origin: 'https://evil.example' });

    expect(response.ok).toBe(false);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
