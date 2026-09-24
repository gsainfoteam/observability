import { type Span } from '@opentelemetry/api';
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions';
import { expect, test } from 'bun:test';
import { of } from 'rxjs';

import { initializeMetrics } from '../metrics';
import { HTTP_SERVER_SPAN_KEY, stashHttpServerSpan } from '../otel/http-route-span';
import { MetricsInterceptor } from './metrics.interceptor';

type MockSpan = Span & {
  attributes: Record<string, unknown>;
  name: string;
};

function createMockSpan(name = 'GET'): MockSpan {
  const attributes: Record<string, unknown> = {};
  const span = {
    attributes,
    name,
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return span;
    },
    updateName(nextName: string) {
      span.name = nextName;
      return span;
    },
    spanContext() {
      return {
        traceId: '0'.repeat(32),
        spanId: '0'.repeat(16),
        traceFlags: 1,
      };
    },
  };

  return span as MockSpan;
}

test('MetricsInterceptor sets Fastify route template on the HTTP server span', () => {
  initializeMetrics('http-route-span-test');

  const httpSpan = createMockSpan();
  const incoming = {
    httpVersion: '1.1',
    method: 'GET',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const interceptor = new MetricsInterceptor();
  const req = {
    method: 'GET',
    url: '/users/123',
    routeOptions: { url: '/users/:id' },
    raw: incoming,
  };
  const executionContext = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  };

  interceptor
    .intercept(executionContext as never, { handle: () => of(null) })
    .subscribe();

  expect(incoming[HTTP_SERVER_SPAN_KEY]).toBe(httpSpan);
  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(httpSpan.name).toBe('GET /users/:id');
});
