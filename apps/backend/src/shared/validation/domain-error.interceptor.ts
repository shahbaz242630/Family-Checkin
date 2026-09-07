import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { DomainError } from './domain-error';

/**
 * Turns a `DomainError` thrown anywhere below a controller into its HTTP answer: the status the rule carries
 * (400 or 409 today) with `{ code, message, ...details }` as the body (CB-042). Registered once as an
 * `APP_INTERCEPTOR` in `AppModule`, so a service can refuse a request without every controller repeating the
 * mapping — and a rule added later cannot be a 500 by omission.
 */
@Injectable()
export class DomainErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error: unknown) => throwError(() => toHttpFailure(error))));
  }
}

/** The `HttpException` a domain failure deserves; anything else is passed through untouched. */
export function toHttpFailure(error: unknown): unknown {
  if (!(error instanceof DomainError)) {
    return error;
  }

  const body = error.toResponseBody();
  switch (error.httpStatus) {
    case 400:
      return new BadRequestException(body);
    case 409:
      return new ConflictException(body);
    default:
      return new HttpException(body, error.httpStatus);
  }
}
