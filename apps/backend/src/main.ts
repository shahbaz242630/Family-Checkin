import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);
  app.enableCors({
    origin: ['http://localhost:8081', 'http://127.0.0.1:8081'],
    credentials: true,
  });
  await app.listen(config.port);
}

void bootstrap();
