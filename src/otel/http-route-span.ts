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

function setHttpRouteOnSpan(span: Span, req: unknown, route: string): void {
  span.setAttribute(ATTR_HTTP_ROUTE, route);
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
 * Call this from a Nest interceptor after routing. It:
 * 1. Stashes the template on the request / `req.raw` for the HTTP span hook
 * 2. Sets `http.route` on the SERVER span stashed by `requestHook`
 * 3. Best-effort: sets `rpcMetadata.route` (Express-compatible) and the active span
 */
export function applyHttpRouteToSpans(
  req: unknown,
  route: string = normalizeHttpRoute(req),
): string {
  stashOnRequestAndRaw(req, (carrier) => {
    carrier[HTTP_ROUTE_REQUEST_KEY] = route;
  });

  const labeled = new Set<Span>();
  const label = (span: Span | undefined): void => {
    if (!span || labeled.has(span)) {
      return;
    }

    labeled.add(span);
    setHttpRouteOnSpan(span, req, route);
  };

  label(readStashedHttpServerSpan(req));

  const rpcMetadata = getRPCMetadata(context.active());
  if (rpcMetadata?.type === RPCType.HTTP) {
    rpcMetadata.route = route;
    label(rpcMetadata.span);
  }

  label(trace.getActiveSpan());

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
  setHttpRouteOnSpan(span, request, route);
}
