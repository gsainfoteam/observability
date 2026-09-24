import { context, ROOT_CONTEXT, trace, type Span } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { getRPCMetadata, RPCType, setRPCMetadata } from '@opentelemetry/core';
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions';
import { expect, test } from 'bun:test';

import { normalizeHttpRoute } from '../metrics/normalize-route';
import {
  applyHttpRouteOnIncomingSpan,
  applyHttpRouteToSpans,
  HTTP_ROUTE_REQUEST_KEY,
  HTTP_SERVER_SPAN_KEY,
  isIncomingHttpRequest,
  stashHttpServerSpan,
} from './http-route-span';

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

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

test('requestHook-equivalent IncomingMessage has no Fastify template yet', () => {
  const incoming = {
    httpVersion: '1.1',
    method: 'GET',
    url: '/users/123?active=1',
  };

  expect(normalizeHttpRoute(incoming)).toBe('unmatched');
});

test('stashHttpServerSpan ignores outgoing ClientRequest', () => {
  const span = createMockSpan();
  const clientRequest = { method: 'GET', path: '/users/123' };

  stashHttpServerSpan(clientRequest, span);
  expect(
    (clientRequest as { [HTTP_SERVER_SPAN_KEY]?: Span })[HTTP_SERVER_SPAN_KEY],
  ).toBeUndefined();
});

test('applyHttpRouteToSpans labels the SERVER span stashed on Fastify req.raw', () => {
  const httpSpan = createMockSpan('GET');
  const incoming = {
    httpVersion: '1.1',
    method: 'GET',
    url: '/users/123?active=1',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const req = {
    method: 'GET',
    url: '/users/123?active=1',
    routeOptions: { url: '/users/:id', method: 'GET' },
    raw: incoming,
  };

  const route = applyHttpRouteToSpans(req);

  expect(route).toBe('/users/:id');
  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(httpSpan.name).toBe('GET /users/:id');
  expect(req[HTTP_ROUTE_REQUEST_KEY]).toBe('/users/:id');
  expect(incoming[HTTP_ROUTE_REQUEST_KEY]).toBe('/users/:id');
});

test('applyHttpRouteToSpans prefers the route template over a concrete path', () => {
  const httpSpan = createMockSpan();
  const incoming = { httpVersion: '1.1', method: 'GET', url: '/orders/abc/items/99' };
  stashHttpServerSpan(incoming, httpSpan);

  applyHttpRouteToSpans({
    method: 'GET',
    url: '/orders/abc/items/99',
    routeOptions: { url: '/orders/:orderId/items/:itemId' },
    raw: incoming,
  });

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe(
    '/orders/:orderId/items/:itemId',
  );
});

test('applyHttpRouteToSpans uses unmatched when no template exists', () => {
  const httpSpan = createMockSpan();
  const incoming = {
    httpVersion: '1.1',
    method: 'GET',
    url: '/unregistered/path?x=1',
  };
  stashHttpServerSpan(incoming, httpSpan);

  applyHttpRouteToSpans({
    method: 'GET',
    url: '/unregistered/path?x=1',
    raw: incoming,
  });

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('unmatched');
  expect(httpSpan.name).toBe('GET unmatched');
});

test('applyHttpRouteToSpans writes rpcMetadata.route when context is available', () => {
  const httpSpan = createMockSpan('GET');
  const ctx = setRPCMetadata(ROOT_CONTEXT, {
    type: RPCType.HTTP,
    span: httpSpan,
  });

  context.with(ctx, () => {
    applyHttpRouteToSpans({
      method: 'GET',
      routeOptions: { url: '/users/:id' },
    });

    expect(getRPCMetadata(context.active())?.route).toBe('/users/:id');
    expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
    expect(httpSpan.name).toBe('GET /users/:id');
  });
});

test('applyHttpRouteToSpans also labels the active Nest child span', () => {
  const httpSpan = createMockSpan('GET');
  const nestSpan = createMockSpan('UsersController.get');
  const incoming = { httpVersion: '1.1', method: 'GET', url: '/users/123' };
  stashHttpServerSpan(incoming, httpSpan);

  const ctx = trace.setSpan(ROOT_CONTEXT, nestSpan);

  context.with(ctx, () => {
    applyHttpRouteToSpans({
      method: 'GET',
      routeOptions: { url: '/users/:id' },
      raw: incoming,
    });

    expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
    expect(nestSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
    expect(nestSpan.name).toBe('GET /users/:id');
  });
});

test('applyHttpRouteOnIncomingSpan reads the interceptor stash on IncomingMessage', () => {
  const span = createMockSpan();
  const incoming = {
    httpVersion: '1.1',
    method: 'GET',
    url: '/users/123',
    [HTTP_ROUTE_REQUEST_KEY]: '/users/:id',
  };

  applyHttpRouteOnIncomingSpan(span, incoming);

  expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(span.name).toBe('GET /users/:id');
});

test('applyHttpRouteOnIncomingSpan uses Express route.path on IncomingMessage', () => {
  const span = createMockSpan();

  applyHttpRouteOnIncomingSpan(span, {
    httpVersion: '1.1',
    method: 'POST',
    url: '/api/users/123',
    baseUrl: '/api',
    route: { path: '/users/:id' },
  });

  expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('/api/users/:id');
  expect(span.name).toBe('POST /api/users/:id');
});

test('applyHttpRouteOnIncomingSpan does not label outgoing ClientRequest spans', () => {
  const span = createMockSpan('GET');
  const clientRequest = {
    method: 'GET',
    path: '/users/123',
    protocol: 'http:',
  };

  expect(isIncomingHttpRequest(clientRequest)).toBe(false);
  applyHttpRouteOnIncomingSpan(span, clientRequest);
  expect(span.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
  expect(span.name).toBe('GET');
});

test('applyHttpRouteOnIncomingSpan labels Fastify IncomingMessage unmatched without a stash', () => {
  const span = createMockSpan();

  applyHttpRouteOnIncomingSpan(span, {
    httpVersion: '1.1',
    method: 'GET',
    url: '/users/123',
  });

  expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('unmatched');
});
