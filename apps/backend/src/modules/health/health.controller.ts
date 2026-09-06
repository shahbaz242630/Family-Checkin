import { Controller, Get, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** A probe that waits longer than this reports the API as degraded rather than hanging the health check. */
export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** The one query the probe runs. Anything that needs the database is `degraded` when it fails or stalls. */
export interface HealthDatabase {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

export interface HealthReport {
  status: 'ok';
}

/**
 * `GET /health` for the host's liveness probe (CB-048): unauthenticated, throttled like every other route, and it
 * answers only `{ status: 'ok' }` (200) or `{ status: 'degraded' }` (503). No version, uptime, host or error
 * detail leaves the process through this route.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly database: HealthDatabase,
    @Optional() private readonly timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    if (!(await this.databaseAnswers())) {
      throw new HttpException({ status: 'degraded' }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'ok' };
  }

  private async databaseAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.timeoutMs);
    });

    try {
      const query = this.database.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      );
      return await Promise.race([query, timedOut]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
