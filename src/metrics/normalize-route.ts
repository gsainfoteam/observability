const UNMATCHED_ROUTE = 'unmatched';

type HttpRequestLike = {
  baseUrl?: unknown;
  route?: { path?: unknown };
  routerPath?: unknown;
  routeOptions?: { url?: unknown };
};

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
 * Uses only matched route templates (`/users/:id`). Concrete request paths are
 * never used as metric labels, so path parameters cannot explode Prometheus
 * cardinality.
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
