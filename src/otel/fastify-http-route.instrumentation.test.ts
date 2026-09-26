import { expect, test } from 'bun:test';

import {
  attachFastifyHttpRouteHookToAdapter,
  patchNestFastifyAdapter,
} from './fastify-http-route.instrumentation';
import { registerFastifyHttpRouteHook } from './http-route-span';

test('attachFastifyHttpRouteHookToAdapter uses getInstance()', () => {
  const hooks: Record<string, unknown[]> = {};
  const instance = {
    addHook(name: string, handler: unknown) {
      (hooks[name] ??= []).push(handler);
    },
  };

  attachFastifyHttpRouteHookToAdapter({
    getInstance: () => instance,
  });

  expect(hooks.onRequest).toHaveLength(1);
});

test('patchNestFastifyAdapter wraps FastifyAdapter constructor', () => {
  class FastifyAdapter {
    instance = {
      hooks: {} as Record<string, unknown[]>,
      addHook(this: { hooks: Record<string, unknown[]> }, name: string, handler: unknown) {
        (this.hooks[name] ??= []).push(handler);
      },
    };

    getInstance() {
      return this.instance;
    }
  }

  const moduleExports = { FastifyAdapter };
  patchNestFastifyAdapter(moduleExports);
  patchNestFastifyAdapter(moduleExports);

  const adapter = new moduleExports.FastifyAdapter();
  expect(adapter.getInstance().hooks.onRequest).toHaveLength(1);
});

test('registerFastifyHttpRouteHook ignores objects without addHook', () => {
  expect(() => registerFastifyHttpRouteHook({})).not.toThrow();
  expect(() => registerFastifyHttpRouteHook(undefined)).not.toThrow();
});
