const UNMATCHED_ROUTE = 'unmatched';

type HttpRequestLike = {
  baseUrl?: unknown;
  route?: { path?: unknown };
  routerPath?: unknown;
  routeOptions?: { url?: unknown };
};

/** Trim strings, returning undefined for non-strings or whitespace-only values. */
function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a low-cardinality HTTP route label from an Express or Fastify Nest request.
 *
 * Prefers the Express `baseUrl` + `route.path` template, then Fastify
 * `routeOptions.url`. Uses legacy `routerPath` only when `routeOptions` is not
 * an object. Returns `unmatched` if no eligible nonblank string template exists.
 * Concrete request paths are never used as metric labels or as the primary
 * span `http.route`; a template such as `/users/:id` keeps path parameters
 * out of cardinality-sensitive attributes.
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

  return UNMATCHED_ROUTE;
}
