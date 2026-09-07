import { ConflictException, HttpException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { DomainError, InvalidRequestError } from './domain-error';
import { DomainErrorInterceptor, toHttpFailure } from './domain-error.interceptor';

class SixthBackupContactError extends DomainError {
  constructor() {
    super('BACKUP_CONTACT_LIMIT_REACHED', 'A receiver can have at most 5 active backup contacts', 409, { limit: '5' });
  }
}

const context = {} as never;

async function through(interceptor: DomainErrorInterceptor, error: unknown): Promise<unknown> {
  const handler = { handle: () => throwError(() => error) };
  return firstValueFrom(interceptor.intercept(context, handler)).then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('DomainError (CB-042)', () => {
  it('carries a machine-readable code, a status and details into the response body', () => {
    const error = new SixthBackupContactError();

    expect(error.httpStatus).toBe(409);
    expect(error.name).toBe('SixthBackupContactError');
    expect(error.toResponseBody()).toEqual({
      code: 'BACKUP_CONTACT_LIMIT_REACHED',
      message: 'A receiver can have at most 5 active backup contacts',
      limit: '5',
    });
  });

  it('defaults to 400 for an invalid request', () => {
    const error = new InvalidRequestError('RECEIVER_FIELD_INVALID', 'Receiver name is required', { field: 'name' });

    expect(error.httpStatus).toBe(400);
    expect(error.toResponseBody()).toEqual({
      code: 'RECEIVER_FIELD_INVALID',
      message: 'Receiver name is required',
      field: 'name',
    });
  });
});

describe('DomainErrorInterceptor (CB-042)', () => {
  it('turns a domain failure into its own 4xx instead of a 500', async () => {
    const error = await through(new DomainErrorInterceptor(), new SixthBackupContactError());

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'BACKUP_CONTACT_LIMIT_REACHED' });
  });

  it('leaves anything else alone, so a real fault is still a 500 and still visible', async () => {
    const outage = new Error('connection terminated unexpectedly');

    expect(await through(new DomainErrorInterceptor(), outage)).toBe(outage);
  });

  it('passes a successful response through untouched', async () => {
    const interceptor = new DomainErrorInterceptor();

    await expect(firstValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }))).resolves.toEqual({
      ok: true,
    });
  });

  it('does not rewrap an HttpException a controller already chose', () => {
    const conflict = new ConflictException({ code: 'OPT_OUT_COOLDOWN' });

    expect(toHttpFailure(conflict)).toBe(conflict);
  });
});
