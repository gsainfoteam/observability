import { context, trace, type Span } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions';

import { normalizeHttpRoute } from '../metrics/normalize-route';

/**
 * Route template stashed on the Nest/Fastify request and its raw
 * IncomingMessage. `applyCustomAttributesOnSpan` only sees IncomingMessage,
 * which does not carry Fastify `routeOptions`.
 */
export const HTTP_ROUTE_REQUEST_KEY = Symbol.for(
  'nest-observability.httpRoute',
);

/**
 * HTTP SERVER span stashed by `requestHook`. That hook runs before routing, so
 * it cannot set `http.route`, but it can keep a handle to the span Fastify
 * later wraps as `req.raw`.
 */
export const HTTP_SERVER_SPAN_KEY = Symbol.for(
  'nest-observability.httpServerSpan',
);

const FASTIFY_HTTP_ROUTE_HOOK_KEY = Symbol.for(
  'nest-observability.fastifyHttpRouteHook',
);

type RequestCarrier = {
  [HTTP_ROUTE_REQUEST_KEY]?: string;
  [HTTP_SERVER_SPAN_KEY]?: Span;
  raw?: unknown;
  method?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRequestCarrier(req: unknown): RequestCarrier | undefined {
  if (!req || typeof req !== 'object') {
    return undefined;
  }

  return req as RequestCarrier;
}

function readStashedRoute(req: unknown): string | undefined {
  const carrier = asRequestCarrier(req);
  if (!carrier) {
    return undefined;
  }

  return (
    asNonEmptyString(carrier[HTTP_ROUTE_REQUEST_KEY]) ??
    readStashedRoute(carrier.raw)
  );
}

function readStashedHttpServerSpan(req: unknown): Span | undefined {
  const carrier = asRequestCarrier(req);
  if (!carrier) {
    return undefined;
  }

  return carrier[HTTP_SERVER_SPAN_KEY] ?? readStashedHttpServerSpan(carrier.raw);
}

function stashOnRequestAndRaw(
  req: unknown,
  assign: (carrier: RequestCarrier) => void,
): void {
  const carrier = asRequestCarrier(req);
  if (!carrier) {
    return;
  }

  assign(carrier);

  if (carrier.raw && typeof carrier.raw === 'object') {
    assign(carrier.raw as RequestCarrier);
  }
}

function requestMethod(req: unknown): string {
  return asNonEmptyString(asRequestCarrier(req)?.method) ?? 'GET';
}

/**
 * Incoming Node HTTP requests expose `httpVersion`. Outgoing `ClientRequest`
 * objects do not. HTTP `requestHook` / `applyCustomAttributesOnSpan` run for
 * both kinds.
 */
export function isIncomingHttpRequest(request: unknown): boolean {
  return (
    !!request &&
    typeof request === 'object' &&
    'httpVersion' in request &&
    typeof (request as { httpVersion?: unknown }).httpVersion === 'string'
  );
}

function setHttpRouteAttribute(span: Span, route: string): void {
  span.setAttribute(ATTR_HTTP_ROUTE, route);
}

function setHttpRouteOnServerSpan(span: Span, req: unknown, route: string): void {
  setHttpRouteAttribute(span, route);
  span.updateName(`${requestMethod(req)} ${route}`);
}

/**
 * Store the inbound HTTP SERVER span on IncomingMessage. Call from HTTP
 * `requestHook` — routing has not happened yet, so do not set `http.route`
 * here.
 */
export function stashHttpServerSpan(request: unknown, span: Span): void {
  if (!isIncomingHttpRequest(request)) {
    return;
  }

  (request as RequestCarrier)[HTTP_SERVER_SPAN_KEY] = span;
}

/**
 * Publish the matched route template (or `unmatched`) onto inbound HTTP spans.
 *
 * `@opentelemetry/instrumentation-http` creates the SERVER span before Nest or
 * Fastify match a route. Express instrumentation later writes
 * `rpcMetadata.route`; Fastify instrumentation is not in
 * `auto-instrumentations-node` 0.80. Nest instrumentation sets `http.route`
 * only on child handler spans, so Tempo still shows an empty path on the
 * SERVER span.
 *
 * Call this from a Nest interceptor after routing, or from a Fastify
 * `onRequest`/`onResponse` hook so CORS preflight OPTIONS is labeled even
 * when Nest interceptors never run. It:
 * 1. Stashes the template on the request / `req.raw` for the HTTP span hook
 * 2. Sets `http.route` and renames the SERVER span stashed by `requestHook`
 *    (and `rpcMetadata.span`) to `{method} {route}`
 * 3. Sets `http.route` on the active span without renaming it — that span is
 *    often a Nest handler child (`UsersController.get`)
 */
export function applyHttpRouteToSpans(
  req: unknown,
  route: string = normalizeHttpRoute(req),
): string {
  stashOnRequestAndRaw(req, (carrier) => {
    carrier[HTTP_ROUTE_REQUEST_KEY] = route;
  });

  const labeled = new Set<Span>();
  const labelServer = (span: Span | undefined): void => {
    if (!span || labeled.has(span)) {
      return;
    }

    labeled.add(span);
    setHttpRouteOnServerSpan(span, req, route);
  };

  labelServer(readStashedHttpServerSpan(req));

  const rpcMetadata = getRPCMetadata(context.active());
  if (rpcMetadata?.type === RPCType.HTTP) {
    rpcMetadata.route = route;
    labelServer(rpcMetadata.span);
  }

  const activeSpan = trace.getActiveSpan();
  if (activeSpan && !labeled.has(activeSpan)) {
    labeled.add(activeSpan);
    setHttpRouteAttribute(activeSpan, route);
  }

  return route;
}

/**
 * Late-binding fallback for `@opentelemetry/instrumentation-http`
 * `applyCustomAttributesOnSpan`. Incoming SERVER requests only — outgoing
 * client spans must not be labeled `unmatched`.
 *
 * `requestHook` is too early for the template. This hook runs at response
 * finish with IncomingMessage. Fastify templates are available only if
 * {@link applyHttpRouteToSpans} already stashed them. Express `req.route.path`
 * lives on IncomingMessage itself.
 */
export function applyHttpRouteOnIncomingSpan(span: Span, request: unknown): void {
  if (!isIncomingHttpRequest(request)) {
    return;
  }

  const route = readStashedRoute(request) ?? normalizeHttpRoute(request);
  setHttpRouteOnServerSpan(span, request, route);
}

type FastifyHookInstance = {
  addHook?: (name: string, handler: FastifyLifecycleHook) => unknown;
  [FASTIFY_HTTP_ROUTE_HOOK_KEY]?: true;
};

type FastifyLifecycleHook = (
  request: unknown,
  reply: unknown,
  done?: (err?: Error) => void,
) => void;

/**
 * Label inbound HTTP SERVER spans from Fastify after routing, including CORS
 * preflight OPTIONS that `@fastify/cors` answers in `onRequest` before Nest
 * interceptors run. Safe to call more than once on the same instance.
 */
export function registerFastifyHttpRouteHook(instance: unknown): void {
  if (!instance || typeof instance !== 'object') {
    return;
  }

  const app = instance as FastifyHookInstance;
  if (typeof app.addHook !== 'function' || app[FASTIFY_HTTP_ROUTE_HOOK_KEY]) {
    return;
  }

  app[FASTIFY_HTTP_ROUTE_HOOK_KEY] = true;

  const applyRoute = (
    request: unknown,
    _reply: unknown,
    done?: (err?: Error) => void,
  ): void => {
    try {
      applyHttpRouteToSpans(request);
    } catch {
      // Observability must not fail the request.
    }

    if (typeof done === 'function') {
      done();
    }
  };

  // onRequest runs after Fastify routing and before CORS may reply.
  // onResponse still runs if an earlier hook sent the preflight response.
  app.addHook('onRequest', applyRoute);
  app.addHook('onResponse', applyRoute);
}

/**
 * Wrap a Fastify factory so every created instance gets
 * {@link registerFastifyHttpRouteHook}. Used by the SDK instrumentation.
 */
export function wrapFastifyFactory<T>(factory: T): T {
  if (typeof factory !== 'function') {
    return factory;
  }

  const original = factory as (...args: unknown[]) => unknown;

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const instance = original.apply(this, args);
    if (instance && typeof (instance as { then?: unknown }).then === 'function') {
      return Promise.resolve(instance).then((app) => {
        registerFastifyHttpRouteHook(app);
        return app;
      });
    }

    registerFastifyHttpRouteHook(instance);
    return instance;
  };

  Object.assign(wrapped, original);
  Object.setPrototypeOf(wrapped, Object.getPrototypeOf(original));

  return wrapped as T;
}

/**
 * Patch `fastify` / `fastify.default` / `fastify.fastify` factory exports.
 */
export function patchFastifyModuleExports<T>(moduleExports: T): T {
  if (typeof moduleExports === 'function') {
    const wrapped = wrapFastifyFactory(moduleExports) as ((
      ...args: unknown[]
    ) => unknown) & {
      default?: unknown;
      fastify?: unknown;
    };
    wrapped.default = wrapped;
    wrapped.fastify = wrapped;
    return wrapped as T;
  }

  if (!moduleExports || typeof moduleExports !== 'object') {
    return moduleExports;
  }

  const exportsObject = moduleExports as {
    default?: unknown;
    fastify?: unknown;
  };
  const factory = exportsObject.fastify ?? exportsObject.default;
  if (typeof factory !== 'function') {
    return moduleExports;
  }

  const wrapped = wrapFastifyFactory(factory);
  if (exportsObject.fastify === factory) {
    exportsObject.fastify = wrapped;
  }
  if (exportsObject.default === factory) {
    exportsObject.default = wrapped;
  }

  return moduleExports;
}
