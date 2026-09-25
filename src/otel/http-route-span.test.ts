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
  patchFastifyModuleExports,
  registerFastifyHttpRouteHook,
  stashHttpServerSpan,
  wrapFastifyFactory,
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
    expect(httpSpan.name).toBe('GET /users/:id');
    expect(nestSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
    expect(nestSpan.name).toBe('UsersController.get');
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

test('applyHttpRouteToSpans labels OPTIONS with the Fastify template', () => {
  const httpSpan = createMockSpan('OPTIONS');
  const incoming = {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  applyHttpRouteToSpans({
    method: 'OPTIONS',
    url: '/users/123',
    routeOptions: { url: '/users/:id', method: 'OPTIONS' },
    raw: incoming,
  });

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(httpSpan.name).toBe('OPTIONS /users/:id');
});

test('applyHttpRouteOnIncomingSpan labels OPTIONS IncomingMessage unmatched without Fastify routing', () => {
  const span = createMockSpan('OPTIONS');

  applyHttpRouteOnIncomingSpan(span, {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  });

  expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('unmatched');
  expect(span.name).toBe('OPTIONS unmatched');
});

function createFakeFastifyInstance() {
  const hooks: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    hooks,
    addHook(name: string, handler: (...args: unknown[]) => void) {
      (hooks[name] ??= []).push(handler);
    },
  };
}

test('registerFastifyHttpRouteHook labels OPTIONS without a Nest interceptor', () => {
  const httpSpan = createMockSpan('OPTIONS');
  const incoming = {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const instance = createFakeFastifyInstance();
  registerFastifyHttpRouteHook(instance);
  registerFastifyHttpRouteHook(instance);

  expect(instance.hooks.onRequest).toHaveLength(1);
  expect(instance.hooks.onResponse).toHaveLength(1);

  const request = {
    method: 'OPTIONS',
    url: '/users/123',
    routeOptions: { url: '/users/:id', method: 'OPTIONS' },
    raw: incoming,
  };

  instance.hooks.onRequest?.[0]?.(request, {}, () => undefined);

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(httpSpan.name).toBe('OPTIONS /users/:id');
});

test('registerFastifyHttpRouteHook uses CORS OPTIONS * template when that is the matched route', () => {
  const httpSpan = createMockSpan('OPTIONS');
  const incoming = {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const instance = createFakeFastifyInstance();
  registerFastifyHttpRouteHook(instance);

  instance.hooks.onRequest?.[0]?.(
    {
      method: 'OPTIONS',
      url: '/users/123',
      routeOptions: { url: '*', method: 'OPTIONS' },
      raw: incoming,
    },
    {},
    () => undefined,
  );

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('*');
  expect(httpSpan.name).toBe('OPTIONS *');
});

test('registerFastifyHttpRouteHook onResponse still labels when onRequest was skipped', () => {
  const httpSpan = createMockSpan('OPTIONS');
  const incoming = {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const instance = createFakeFastifyInstance();
  registerFastifyHttpRouteHook(instance);

  instance.hooks.onResponse?.[0]?.(
    {
      method: 'OPTIONS',
      url: '/users/123',
      routeOptions: { url: '/users/:id', method: 'OPTIONS' },
      raw: incoming,
    },
    {},
    () => undefined,
  );

  expect(httpSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(httpSpan.name).toBe('OPTIONS /users/:id');
});

test('wrapFastifyFactory registers the hook on created instances', () => {
  const factory = wrapFastifyFactory(() => createFakeFastifyInstance());
  const instance = factory();
  expect(instance.hooks.onRequest).toHaveLength(1);
});

test('patchFastifyModuleExports wraps function and named exports', () => {
  const factory = Object.assign(() => createFakeFastifyInstance(), {
    extra: true,
  });
  const wrapped = patchFastifyModuleExports(factory) as typeof factory & {
    fastify: typeof factory;
    default: typeof factory;
  };

  expect(typeof wrapped).toBe('function');
  expect(wrapped.fastify).toBe(wrapped);
  expect(wrapped.default).toBe(wrapped);
  expect(wrapped().hooks.onRequest).toHaveLength(1);
});

test('Fastify OPTIONS hook does not rename a Nest handler child span', () => {
  const httpSpan = createMockSpan('OPTIONS');
  const nestSpan = createMockSpan('UsersController.options');
  const incoming = {
    httpVersion: '1.1',
    method: 'OPTIONS',
    url: '/users/123',
  };
  stashHttpServerSpan(incoming, httpSpan);

  const instance = createFakeFastifyInstance();
  registerFastifyHttpRouteHook(instance);

  const ctx = trace.setSpan(ROOT_CONTEXT, nestSpan);
  context.with(ctx, () => {
    instance.hooks.onRequest?.[0]?.(
      {
        method: 'OPTIONS',
        url: '/users/123',
        routeOptions: { url: '/users/:id', method: 'OPTIONS' },
        raw: incoming,
      },
      {},
      () => undefined,
    );
  });

  expect(httpSpan.name).toBe('OPTIONS /users/:id');
  expect(nestSpan.attributes[ATTR_HTTP_ROUTE]).toBe('/users/:id');
  expect(nestSpan.name).toBe('UsersController.options');
});
