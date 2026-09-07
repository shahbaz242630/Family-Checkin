import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodError, core } from 'zod';

/** Every body rejected by a schema answers with this code; the per-field detail is in `issues` (CB-042). */
export const BODY_VALIDATION_FAILED_CODE = 'VALIDATION_FAILED';
export const BODY_VALIDATION_FAILED_MESSAGE = 'Request body is invalid';
/** Enough to fix a request without turning a fuzzed body into a large response. */
export const MAX_REPORTED_ISSUES = 20;

export interface BodyValidationIssue {
  /** Dotted path of the offending field, `''` for the body itself. */
  path: string;
  /** Zod's issue code (`invalid_type`, `invalid_value`, `too_big`, `custom`, …). */
  code: string;
  message: string;
}

export interface BodyValidationFailure {
  code: typeof BODY_VALIDATION_FAILED_CODE;
  message: string;
  issues: BodyValidationIssue[];
}

/**
 * Validates a request body against a zod schema and replaces it with the parsed value, so a handler never sees
 * a shape it did not ask for (CB-042). Applied per route — `@Body(new ZodBodyPipe(schema))` — because each body
 * has its own schema; the schemas live in `@nearby/shared-types` so the app can reuse them.
 *
 * Only the reported issue path, code and message leave the process: a zod message never echoes the received
 * value, so a rejected body cannot bounce a phone number or a note back to the caller or into a log.
 */
export class ZodBodyPipe<TSchema extends ZodType> implements PipeTransform<unknown, core.output<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, metadata?: ArgumentMetadata): core.output<TSchema> {
    if (metadata && metadata.type !== 'body') {
      throw new Error('ZodBodyPipe validates request bodies only');
    }

    // An empty POST/PATCH body arrives as undefined; a schema whose fields are all optional must still accept it.
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException(bodyValidationFailure(result.error));
    }

    return result.data;
  }
}

export function bodyValidationFailure(error: ZodError): BodyValidationFailure {
  return {
    code: BODY_VALIDATION_FAILED_CODE,
    message: BODY_VALIDATION_FAILED_MESSAGE,
    issues: error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}
