const UNMATCHED_ROUTE = 'unmatched';

type HttpRequestLike = {
  baseUrl?: unknown;
  route?: { path?: unknown };
  routerPath?: unknown;
  routeOptions?: { url?: unknown };
  originalUrl?: unknown;
  path?: unknown;
  url?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripQueryAndHash(url: string): string {
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  let end = url.length;

  if (queryIndex !== -1) {
    end = queryIndex;
  }

  if (hashIndex !== -1 && hashIndex < end) {
    end = hashIndex;
  }

  return url.slice(0, end);
}

function pathnameFromUrlLike(value: unknown): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return undefined;
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      return new URL(raw).pathname;
    } catch {
      return stripQueryAndHash(raw);
    }
  }

  const pathname = stripQueryAndHash(raw);
  return pathname.length > 0 ? pathname : undefined;
}

/**
 * Resolve a low-cardinality HTTP route label from an Express or Fastify Nest request.
 *
 * Prefers the matched route template (`/users/:id`) over the concrete URL so
 * Prometheus metric cardinality does not explode on path parameters.
 */
export function normalizeHttpRoute(req: unknown): string {
  if (!req || typeof req !== 'object') {
    return UNMATCHED_ROUTE;
  }

  const request = req as HttpRequestLike;

  // Express (and Nest ExpressAdapter): mounted template is baseUrl + route.path
  const expressRoutePath = asNonEmptyString(request.route?.path);
  if (expressRoutePath) {
    const baseUrl = asNonEmptyString(request.baseUrl) ?? '';
    return `${baseUrl}${expressRoutePath}`;
  }

  // Fastify >= 4.10 / Fastify 5 (Nest FastifyAdapter): registered URL template.
  // Prefer routeOptions when present so we do not touch deprecated routerPath
  // (FSTDEP017; removed in Fastify 5).
  if (request.routeOptions && typeof request.routeOptions === 'object') {
    const fastifyRouteUrl = asNonEmptyString(request.routeOptions.url);
    if (fastifyRouteUrl) {
      return fastifyRouteUrl;
    }
  } else {
    // Fastify 3 / early 4: routerPath is the registered template
    const fastifyRouterPath = asNonEmptyString(request.routerPath);
    if (fastifyRouterPath) {
      return fastifyRouterPath;
    }
  }

  const fallbackPath =
    pathnameFromUrlLike(request.originalUrl) ??
    pathnameFromUrlLike(request.path) ??
    pathnameFromUrlLike(request.url);

  return fallbackPath ?? UNMATCHED_ROUTE;
}
