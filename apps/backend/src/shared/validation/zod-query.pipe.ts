import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, core } from 'zod';
import { bodyValidationFailure } from './zod-body.pipe';

/**
 * The query-string counterpart of `ZodBodyPipe` (CB-042): `@Query(new ZodQueryPipe(schema))` replaces the raw
 * query object with the parsed value, so a handler never reads an unvalidated `?days=99999999` (CB-036). It
 * answers with the same `{ code: "VALIDATION_FAILED", issues }` body as a rejected request body, because the
 * app already knows that shape.
 *
 * Query values always arrive as strings, so schemas used here coerce before they bound (`z.coerce.number()`).
 */
export class ZodQueryPipe<TSchema extends ZodType> implements PipeTransform<unknown, core.output<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, metadata?: ArgumentMetadata): core.output<TSchema> {
    if (metadata && metadata.type !== 'query') {
      throw new Error('ZodQueryPipe validates query strings only');
    }

    // A request with no query string arrives as an empty object on Express and as undefined in a unit test.
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException(bodyValidationFailure(result.error));
    }

    return result.data;
  }
}
