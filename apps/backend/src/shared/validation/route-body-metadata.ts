import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import type { PipeTransform } from '@nestjs/common';

interface RouteArgMetadata {
  index: number;
  pipes?: (PipeTransform | (new (...args: never[]) => PipeTransform))[];
}

/**
 * The pipes Nest will run on each `@Body()` parameter of `controller.method`, read from the same metadata the
 * framework reads. Specs use it to prove a route is actually wired to its schema, which a spec that calls the
 * controller method directly (as every controller spec here does) could never see (CB-042).
 */
export function bodyParameterPipes(
  controller: abstract new (...args: never[]) => object,
  method: string,
): (PipeTransform | (new (...args: never[]) => PipeTransform))[][] {
  const metadata = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<
    string,
    RouteArgMetadata
  >;

  return Object.entries(metadata)
    .filter(([key]) => key.startsWith(`${RouteParamtypes.BODY}:`))
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([, argument]) => argument.pipes ?? []);
}

/**
 * Runs a request body through the pipes a route actually declares, the way Nest will at run time. Controller
 * specs call handler methods directly, so without this a `@Body(new ZodBodyPipe(...))` could be dropped from a
 * route and every spec would stay green (CB-042).
 */
export function transformBodyThroughRoute(
  controller: abstract new (...args: never[]) => object,
  method: string,
  body: unknown,
  parameterIndex = 0,
): unknown {
  const pipes = bodyParameterPipes(controller, method)[parameterIndex];
  if (!pipes) {
    throw new Error(`${controller.name}.${method} has no @Body() parameter at index ${parameterIndex}`);
  }

  return pipes.reduce<unknown>((value, pipe) => {
    const instance = typeof pipe === 'function' ? new pipe() : pipe;
    return instance.transform(value, { type: 'body', metatype: undefined, data: undefined });
  }, body);
}

/** The pipes Nest will run on each `@Query()` parameter of `controller.method` (CB-036). */
export function queryParameterPipes(
  controller: abstract new (...args: never[]) => object,
  method: string,
): (PipeTransform | (new (...args: never[]) => PipeTransform))[][] {
  const metadata = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<
    string,
    RouteArgMetadata
  >;

  return Object.entries(metadata)
    .filter(([key]) => key.startsWith(`${RouteParamtypes.QUERY}:`))
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([, argument]) => argument.pipes ?? []);
}

/**
 * Runs a query object through the pipes a route actually declares. Without it, a `@Query(new ZodQueryPipe(...))`
 * could be dropped from `GET /receivers/:id/check-ins` and the specs — which call the handler directly — would
 * stay green while `?days=999999` became an unbounded read again (CB-036).
 */
export function transformQueryThroughRoute(
  controller: abstract new (...args: never[]) => object,
  method: string,
  query: unknown,
  parameterIndex = 0,
): unknown {
  const pipes = queryParameterPipes(controller, method)[parameterIndex];
  if (!pipes) {
    throw new Error(`${controller.name}.${method} has no @Query() parameter at index ${parameterIndex}`);
  }

  return pipes.reduce<unknown>((value, pipe) => {
    const instance = typeof pipe === 'function' ? new pipe() : pipe;
    return instance.transform(value, { type: 'query', metatype: undefined, data: undefined });
  }, query);
}
