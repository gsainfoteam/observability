import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { getMetricInstruments, startHttpRequestDurationTimer } from '../metrics';
import { normalizeHttpRoute } from './normalize-route';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  /**
   * Record HTTP request metrics using the method and route template (or
   * `unmatched`) as labels.
   *
   * Counts the request in flight before invoking the handler. When its observable
   * completes, errors, or is unsubscribed, records the total and duration in
   * seconds and decrements the in-flight count. Emitted errors are counted
   * separately and passed through. HTTP exceptions use their status; other
   * errors use the response status if it is at least 400, or 500 otherwise.
   *
   * @throws {Error} If metrics have not been initialized.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const { httpRequestsInFlight, httpRequestsTotal, httpRequestErrorsTotal } =
      getMetricInstruments();

    const method = req.method ?? 'UNKNOWN';
    const route = normalizeHttpRoute(req);

    const endTimer = startHttpRequestDurationTimer({ method, route });

    httpRequestsInFlight.add(1, { method, route });

    let statusCode: string | null = null;

    return next.handle().pipe(
      tap({
        error: (err: unknown) => {
          const rawStatusCode = res.statusCode;
          if (err instanceof HttpException) {
            statusCode = String(err.getStatus());
          } else {
            statusCode = String(
              !rawStatusCode || rawStatusCode < 400 ? 500 : rawStatusCode,
            );
          }

          const errorName =
            err && typeof err === 'object' && 'constructor' in err
              ? ((err as { constructor?: { name?: string } }).constructor
                  ?.name ?? 'UnknownError')
              : 'UnknownError';

          httpRequestErrorsTotal.add(1, {
            method,
            route,
            error_name: errorName,
            status_code: statusCode,
          });
        },
      }),
      finalize(() => {
        const finalStatusCode =
          statusCode === null ? String(res.statusCode ?? 500) : statusCode;

        httpRequestsTotal.add(1, {
          method,
          route,
          status_code: finalStatusCode,
        });

        endTimer({ status_code: finalStatusCode });

        httpRequestsInFlight.add(-1, { method, route });
      }),
    );
  }
}
