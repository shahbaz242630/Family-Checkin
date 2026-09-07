import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AccountController } from '../../modules/account/account.controller';
import { BackupContactsController } from '../../modules/backup-contacts/backup-contacts.controller';
import { BillingController } from '../../modules/billing/billing.controller';
import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { ProviderWebhooksController } from '../../modules/provider-webhooks/provider-webhooks.controller';
import { ReceiverRepliesController } from '../../modules/receivers/receiver-replies.controller';
import { ReceiversController } from '../../modules/receivers/receivers.controller';
import { bodyParameterPipes } from './route-body-metadata';
import { ZodBodyPipe } from './zod-body.pipe';

type ControllerClass = abstract new (...args: never[]) => object;

/** Every controller that takes a request body. CB-042 counted 16 `@Body()` parameters across these seven. */
const controllers: [string, ControllerClass][] = [
  ['AccountController', AccountController],
  ['BackupContactsController', BackupContactsController],
  ['BillingController', BillingController],
  ['NotificationsController', NotificationsController],
  ['ProviderWebhooksController', ProviderWebhooksController],
  ['ReceiverRepliesController', ReceiverRepliesController],
  ['ReceiversController', ReceiversController],
];

const EXPECTED_BODY_PARAMETERS = 16;

function handlerNames(controller: ControllerClass): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');
}

function bodyParameters(controller: ControllerClass): { method: string; pipes: unknown[] }[] {
  return handlerNames(controller).flatMap((method) =>
    bodyParameterPipes(controller, method).map((pipes) => ({ method, pipes })),
  );
}

describe('every request body is validated by a schema (CB-042)', () => {
  it.each(controllers)('%s validates each @Body() with a ZodBodyPipe', (name, controller) => {
    const parameters = bodyParameters(controller);

    expect(parameters.length, `${name} declares no @Body() parameter`).toBeGreaterThan(0);
    for (const { method, pipes } of parameters) {
      expect(
        pipes.some((pipe) => pipe instanceof ZodBodyPipe),
        `${name}.${method} takes a body without a ZodBodyPipe`,
      ).toBe(true);
    }
  });

  it('covers all sixteen body parameters the audit found, so a new unvalidated route is a failing test', () => {
    const total = controllers.reduce((count, [, controller]) => count + bodyParameters(controller).length, 0);

    expect(total).toBe(EXPECTED_BODY_PARAMETERS);
  });
});
