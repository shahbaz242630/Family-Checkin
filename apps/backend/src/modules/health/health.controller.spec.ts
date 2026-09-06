import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HEALTH_CHECK_TIMEOUT_MS, HealthController } from './health.controller';
import type { HealthDatabase } from './health.controller';

function database(behaviour: 'answers' | 'fails' | 'hangs'): HealthDatabase & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    $queryRaw(query: TemplateStringsArray) {
      queries.push(query.join('?'));
      switch (behaviour) {
        case 'answers':
          return Promise.resolve([{ '?column?': 1 }]);
        case 'fails':
          return Promise.reject(new Error("connect ECONNREFUSED db.internal:5432 (password 'hunter2')"));
        default:
          return new Promise(() => undefined);
      }
    },
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('HealthController (CB-048)', () => {
  it('answers 200 { status: "ok" } when SELECT 1 comes back', async () => {
    const db = database('answers');

    await expect(new HealthController(db).check()).resolves.toEqual({ status: 'ok' });
    expect(db.queries).toEqual(['SELECT 1']);
  });

  it('answers 503 { status: "degraded" } and nothing else when the database query fails', async () => {
    const error = await rejectionOf(new HealthController(database('fails')).check());

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toEqual({ status: 'degraded' });
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('ECONNREFUSED');
  });

  it('answers 503 instead of hanging when the database does not answer in time', async () => {
    const error = await rejectionOf(new HealthController(database('hangs'), 20).check());

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toEqual({ status: 'degraded' });
  });

  it('waits five seconds for the database by default', () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBe(5_000);
  });
});
