import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';
import { applyHttpHardening } from './shared/http/http-hardening';
import { JsonLogger, requestIdMiddleware } from './shared/logging';

async function bootstrap() {
  // One JSON object per log line, request-scoped through `requestIdMiddleware`, so a hosted deployment is
  // readable instead of silent (CB-047). Nest's own `Logger` facade inside services routes here.
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  const config = app.get(AppConfigService);
  // Before the hardening middleware so every later handler, and every log line it writes, has the request id.
  app.use(requestIdMiddleware);
  applyHttpHardening(app, config);
  // SIGTERM/SIGINT run every OnModuleDestroy hook (PrismaService disconnects) before the process exits (CB-048).
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
