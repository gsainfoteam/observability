import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';

import {
  patchFastifyModuleExports,
  registerFastifyHttpRouteHook,
} from './http-route-span';

type FastifyAdapterInstance = {
  getInstance?: () => unknown;
  instance?: unknown;
};

type FastifyAdapterConstructor = new (
  ...args: unknown[]
) => FastifyAdapterInstance;

/**
 * Patches Fastify (and Nest's FastifyAdapter) so CORS preflight OPTIONS
 * still get `http.route` after routing, even when Nest interceptors never run.
 */
export class FastifyHttpRouteInstrumentation extends InstrumentationBase {
  constructor() {
    super('nest-observability-fastify-http-route', '0.0.8', {});
  }

  override init(): InstrumentationNodeModuleDefinition[] {
    return [
      new InstrumentationNodeModuleDefinition(
        'fastify',
        ['>=3 <6'],
        (moduleExports: unknown) => patchFastifyModuleExports(moduleExports),
        (moduleExports: unknown) => moduleExports,
      ),
      new InstrumentationNodeModuleDefinition(
        '@nestjs/platform-fastify',
        ['>=10 <12'],
        (moduleExports: unknown) => patchNestFastifyAdapter(moduleExports),
        (moduleExports: unknown) => moduleExports,
      ),
    ];
  }
}

export function attachFastifyHttpRouteHookToAdapter(
  adapter: FastifyAdapterInstance,
): void {
  registerFastifyHttpRouteHook(
    adapter.getInstance?.() ?? adapter.instance,
  );
}

export function patchNestFastifyAdapter<T>(moduleExports: T): T {
  if (!moduleExports || typeof moduleExports !== 'object') {
    return moduleExports;
  }

  const exportsObject = moduleExports as { FastifyAdapter?: FastifyAdapterConstructor };
  const Original = exportsObject.FastifyAdapter;
  if (typeof Original !== 'function') {
    return moduleExports;
  }

  if (
    (Original as FastifyAdapterConstructor & { __otelHttpRoutePatched?: true })
      .__otelHttpRoutePatched
  ) {
    return moduleExports;
  }

  class FastifyAdapter extends Original {
    constructor(...args: unknown[]) {
      super(...args);
      attachFastifyHttpRouteHookToAdapter(this);
    }
  }

  Object.assign(FastifyAdapter, Original);
  (
    FastifyAdapter as typeof FastifyAdapter & { __otelHttpRoutePatched?: true }
  ).__otelHttpRoutePatched = true;
  exportsObject.FastifyAdapter = FastifyAdapter;

  return moduleExports;
}