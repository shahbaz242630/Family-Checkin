import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChannelProviderMode } from './shared/config/app-config.service';

// The real PrismaService opens a database connection in onModuleInit. This spec boots the full DI graph without
// a database, so the class is replaced by an inert stand-in; every repository still receives it by token.
vi.mock('./shared/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const bootEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci',
  KMS_MASTER_KEY_BASE64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  // No SUPABASE_SERVICE_ROLE_KEY: the backend boots and runs without it (CB-025).
  OPERATIONS_CRON_SECRET: 'cron-secret',
};

/**
 * Every `METHOD /path` the API maps in configured mode, derived from the controllers. Kept explicit and sorted so
 * a route that appears, disappears or moves shows up as a diff on this list.
 */
const configuredModeRoutes = [
  'DELETE /account',
  'DELETE /receivers/:receiverId',
  'DELETE /receivers/:receiverId/backup-contacts/:backupContactId',
  'GET /account/export',
  'GET /admin/abuse-reports',
  'GET /admin/abuse-reports/:abuseReportId',
  'GET /auth/admin/me',
  'GET /billing/status',
  'GET /health',
  'GET /operations/check-ins/:checkInId',
  'GET /operations/check-ins/summary',
  'GET /receivers',
  'GET /receivers/:receiverId',
  'GET /receivers/:receiverId/backup-contacts',
  'PATCH /admin/abuse-reports/:abuseReportId/review-action-taken',
  'PATCH /admin/abuse-reports/:abuseReportId/review-safe',
  'PATCH /receivers/:receiverId',
  'PATCH /receivers/:receiverId/backup-contacts/:backupContactId',
  'PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup',
  'PATCH /receivers/:receiverId/check-ins/:checkInId/resolve',
  'PATCH /receivers/:receiverId/check-ins/:checkInId/try-later',
  'PATCH /receivers/:receiverId/pause',
  'PATCH /receivers/:receiverId/resume',
  'POST /account/step-up/request',
  'POST /account/step-up/verify',
  'POST /auth/sync-user',
  'POST /billing/revenuecat/webhook',
  'POST /device-tokens',
  'POST /operations/check-ins/run',
  'POST /provider-webhooks/twilio/messaging',
  'POST /provider-webhooks/twilio/messaging/status',
  'POST /provider-webhooks/twilio/voice',
  'POST /provider-webhooks/twilio/voice/amd',
  'POST /provider-webhooks/twilio/voice/status',
  'POST /receivers',
  'POST /receivers/:receiverId/backup-contacts',
  'POST /receivers/:receiverId/consent/resend',
];

const BOOT_TIMEOUT_MS = 60_000;

/** Routes that must exist only while CHANNEL_PROVIDER_MODE=fake. */
const fakeModeOnlyRoutes = ['GET /receiver-replies/fake/outbound', 'POST /receiver-replies/fake'];

interface ExpressRouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

interface BootedApp {
  app: INestApplication;
  AuditService: typeof import('./modules/audit/audit.service').AuditService;
}

async function bootApp(channelProviderMode: ChannelProviderMode): Promise<BootedApp> {
  // AppModule decides which controllers exist from the environment when it is imported, so every boot needs the
  // environment set first and a fresh module registry.
  vi.resetModules();
  Object.assign(process.env, bootEnv, { CHANNEL_PROVIDER_MODE: channelProviderMode });

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { AuditService } = await import('./modules/audit/audit.service');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();

  return { app, AuditService };
}

function mappedRoutes(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: ExpressRouteLayer[] };
    _router?: { stack: ExpressRouteLayer[] };
  };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  const routes: string[] = [];

  for (const layer of stack) {
    const route = layer.route;
    if (!route) {
      continue;
    }
    for (const [method, enabled] of Object.entries(route.methods)) {
      if (enabled) {
        routes.push(`${method.toUpperCase()} ${route.path}`);
      }
    }
  }

  return routes.sort();
}

describe('AppModule', () => {
  const envBefore = { ...process.env };

  afterAll(() => {
    for (const key of [...Object.keys(bootEnv), 'CHANNEL_PROVIDER_MODE']) {
      const previous = envBefore[key];
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it('keeps the expected route list sorted so drift is a readable diff', () => {
    expect(configuredModeRoutes).toEqual([...configuredModeRoutes].sort());
  });

  describe('with CHANNEL_PROVIDER_MODE=fake', () => {
    let booted: BootedApp;

    // Booting the full graph after vi.resetModules re-imports every module; under the whole suite running in
    // parallel that can exceed vitest's default 10 s hook timeout, so give it room.
    beforeAll(async () => {
      booted = await bootApp('fake');
    }, BOOT_TIMEOUT_MS);

    it('resolves the production AuditService, PII guard included', async () => {
      const auditService = booted.app.get(booted.AuditService);

      expect(auditService).toBeInstanceOf(booted.AuditService);
      await expect(
        auditService.append({
          entityType: 'check_in',
          entityId: 'check-in-1',
          action: 'check_in.escalated',
          actorType: ActorType.SYSTEM,
          metadata: { contactPhone: '+971501234567' },
        }),
      ).rejects.toThrow('Audit metadata must not contain raw PII');
    });

    it('injects the optional collaborators the STOP, REPORT and HELP paths depend on', async () => {
      // These are @Optional() so lightweight spec fakes compile; in the real graph they must resolve, otherwise
      // STOP/REPORT stop cancelling in-flight attempts (CB-008) and HELP stops escalating, silently.
      const { ReceiverReplyService } = await import('./modules/receivers/receiver-reply.service');
      const replyService = booted.app.get(ReceiverReplyService) as unknown as Record<string, unknown>;

      expect(replyService.checkInsService, 'CheckInsService not injected into ReceiverReplyService').toBeDefined();
      expect(
        replyService.escalationsService,
        'EscalationsService not injected into ReceiverReplyService',
      ).toBeDefined();
      // CB-079: the STOP confirmation names the sender through UsersService, like the pause and delete messages.
      expect(replyService.usersService, 'UsersService not injected into ReceiverReplyService').toBeDefined();
    });

    it('injects the optional collaborators the receiver routes depend on', async () => {
      // Found on the emulator 2026-09-06: StepUpService was provided only inside AccountModule, so the controller's
      // @Optional() dependency was undefined in the real graph and every DELETE /receivers/:id was a 403 while the
      // unit spec (which injects a fake) stayed green. The billing gate and backup-contact listing are the same shape.
      const { ReceiversController } = await import('./modules/receivers/receivers.controller');
      const controller = booted.app.get(ReceiversController) as unknown as Record<string, unknown>;

      expect(controller.stepUpService, 'StepUpService not injected into ReceiversController').toBeDefined();
      expect(controller.billingService, 'BillingService not injected into ReceiversController').toBeDefined();
      expect(
        controller.backupContactsService,
        'BackupContactsService not injected into ReceiversController',
      ).toBeDefined();
    });

    it('maps every expected route plus the fake reply and fake outbound routes', () => {
      expect(mappedRoutes(booted.app)).toEqual([...configuredModeRoutes, ...fakeModeOnlyRoutes].sort());
    });

    it('wires the one FakeOutboundRecorder into every fake provider and the fake outbound route', async () => {
      // CB-067: the recorder the GET route reads must be the same instance the providers write to, otherwise the
      // route lists nothing while the terminal shows sends (or vice versa). Asserted by identity because the
      // catalog would hit the inert PrismaService on a real send in this spec.
      const { FakeOutboundRecorder } = await import('./modules/channels/fake-outbound-recorder');
      const { FakeChannelProvider } = await import('./modules/channels/fake-channel.provider');
      const { CHANNEL_PROVIDERS } = await import('./modules/channels/channels.tokens');
      const { ReceiverRepliesController } = await import('./modules/receivers/receiver-replies.controller');

      const recorder = booted.app.get(FakeOutboundRecorder);
      const providers = booted.app.get<unknown[]>(CHANNEL_PROVIDERS);
      const controller = booted.app.get(ReceiverRepliesController) as unknown as Record<string, unknown>;

      expect(recorder).toBeInstanceOf(FakeOutboundRecorder);
      expect(providers).toHaveLength(3);
      for (const provider of providers) {
        expect(provider).toBeInstanceOf(FakeChannelProvider);
        expect((provider as InstanceType<typeof FakeChannelProvider>).recorder).toBe(recorder);
      }
      expect(controller.fakeOutbound, 'FakeOutboundRecorder not injected into ReceiverRepliesController').toBe(
        recorder,
      );
    });

    it('closes cleanly without a database', async () => {
      await expect(booted.app.close()).resolves.toBeUndefined();
    });
  });

  describe('with CHANNEL_PROVIDER_MODE=configured', () => {
    let booted: BootedApp;

    beforeAll(async () => {
      booted = await bootApp('configured');
    }, BOOT_TIMEOUT_MS);

    it('resolves the production AuditService', () => {
      expect(booted.app.get(booted.AuditService)).toBeInstanceOf(booted.AuditService);
    });

    it('maps every expected route and leaves the fake reply and fake outbound routes out', () => {
      const routes = mappedRoutes(booted.app);

      expect(routes).toEqual(configuredModeRoutes);
      for (const route of fakeModeOnlyRoutes) {
        expect(routes).not.toContain(route);
      }
    });

    it('closes cleanly without a database', async () => {
      await expect(booted.app.close()).resolves.toBeUndefined();
    });
  });
});
