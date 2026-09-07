import { BadRequestException } from '@nestjs/common';
import { receiverCheckInHistoryQuerySchema } from '@nearby/shared-types';
import { describe, expect, it } from 'vitest';
import { BODY_VALIDATION_FAILED_CODE, type BodyValidationFailure } from './zod-body.pipe';
import { ZodQueryPipe } from './zod-query.pipe';

const pipe = new ZodQueryPipe(receiverCheckInHistoryQuerySchema);
const queryMetadata = { type: 'query', metatype: undefined, data: undefined } as const;

describe('ZodQueryPipe (CB-036)', () => {
  it('coerces the query string and applies the schema default', () => {
    expect(pipe.transform({ days: '14' }, queryMetadata)).toEqual({ days: 14 });
    expect(pipe.transform({}, queryMetadata)).toEqual({ days: 30 });
    // Express hands a route with no query string an empty object; a unit call may pass nothing at all.
    expect(pipe.transform(undefined, queryMetadata)).toEqual({ days: 30 });
  });

  it('drops query fields the schema does not declare', () => {
    expect(pipe.transform({ days: '1', limit: '100000', order: 'asc' }, queryMetadata)).toEqual({ days: 1 });
  });

  it('refuses a value outside the bounds with the same failure shape as a rejected body', () => {
    let failure: unknown;
    try {
      pipe.transform({ days: '100000' }, queryMetadata);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(BadRequestException);
    const body = (failure as BadRequestException).getResponse() as BodyValidationFailure;
    expect(body.code).toBe(BODY_VALIDATION_FAILED_CODE);
    expect(body.issues[0]).toMatchObject({ path: 'days' });
  });

  it('refuses anything that is not a whole number of days', () => {
    for (const days of ['0', '-5', '2.5', 'thirty', '', ['1', '2']]) {
      expect(() => pipe.transform({ days }, queryMetadata)).toThrow(BadRequestException);
    }
  });

  it('refuses to be used on anything but a query string', () => {
    expect(() => pipe.transform({}, { type: 'body', metatype: undefined, data: undefined })).toThrow(
      'ZodQueryPipe validates query strings only',
    );
  });
});
