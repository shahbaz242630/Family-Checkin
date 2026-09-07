import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BODY_VALIDATION_FAILED_CODE,
  BODY_VALIDATION_FAILED_MESSAGE,
  MAX_REPORTED_ISSUES,
  ZodBodyPipe,
  type BodyValidationFailure,
} from './zod-body.pipe';

const schema = z.object({
  name: z.string().trim().min(1),
  channel: z.enum(['SMS', 'WHATSAPP']),
  note: z.string().max(5).optional(),
});

const bodyMetadata = { type: 'body' as const, metatype: undefined, data: undefined };

function failureOf(value: unknown): BodyValidationFailure {
  const pipe = new ZodBodyPipe(schema);
  try {
    pipe.transform(value, bodyMetadata);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as BodyValidationFailure;
  }
  throw new Error('expected the pipe to reject the body');
}

describe('ZodBodyPipe (CB-042)', () => {
  it('returns the parsed body, trimmed and without fields the schema does not declare', () => {
    const pipe = new ZodBodyPipe(schema);

    expect(pipe.transform({ name: '  Fatima  ', channel: 'SMS', userId: 'someone-elses' }, bodyMetadata)).toEqual({
      name: 'Fatima',
      channel: 'SMS',
    });
  });

  it('answers 400 with a stable code and one issue per field, never a 500', () => {
    const failure = failureOf({ channel: 'EMAIL', note: 'far too long' });

    expect(failure.code).toBe(BODY_VALIDATION_FAILED_CODE);
    expect(failure.message).toBe(BODY_VALIDATION_FAILED_MESSAGE);
    expect(failure.issues.map((issue) => issue.path).sort()).toEqual(['channel', 'name', 'note']);
    expect(failure.issues.every((issue) => issue.code.length > 0)).toBe(true);
  });

  it('never echoes the value it refused, so a body carrying a phone or a note cannot bounce back', () => {
    const failure = failureOf({ name: '', channel: 'EMAIL', note: '+971501234567' });

    expect(JSON.stringify(failure)).not.toContain('+971501234567');
  });

  it('treats a missing body as an empty object, so a schema with only optional fields still passes', () => {
    const optionalOnly = new ZodBodyPipe(z.object({ note: z.string().optional() }));

    expect(optionalOnly.transform(undefined, bodyMetadata)).toEqual({});
  });

  it('reports at most twenty issues, so a fuzzed body cannot produce an unbounded response', () => {
    const wide = z.object(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${index}`, z.string()])));
    const pipe = new ZodBodyPipe(wide);

    try {
      pipe.transform({}, bodyMetadata);
      throw new Error('expected the pipe to reject the body');
    } catch (error) {
      const failure = (error as BadRequestException).getResponse() as BodyValidationFailure;
      expect(failure.issues).toHaveLength(MAX_REPORTED_ISSUES);
    }
  });

  it('refuses to be used on anything but a body', () => {
    const pipe = new ZodBodyPipe(schema);

    expect(() => pipe.transform('value', { type: 'param', metatype: undefined, data: 'receiverId' })).toThrow(
      'ZodBodyPipe validates request bodies only',
    );
  });

  it('works without metadata, the way a spec calls it directly', () => {
    expect(new ZodBodyPipe(schema).transform({ name: 'Fatima', channel: 'WHATSAPP' })).toEqual({
      name: 'Fatima',
      channel: 'WHATSAPP',
    });
  });
});
