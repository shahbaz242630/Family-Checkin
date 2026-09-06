import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';
import { applyHttpHardening } from './shared/http/http-hardening';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);
  applyHttpHardening(app, config);
  // SIGTERM/SIGINT run every OnModuleDestroy hook (PrismaService disconnects) before the process exits (CB-048).
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
