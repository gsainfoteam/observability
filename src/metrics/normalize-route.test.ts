import { expect, test } from 'bun:test';
import { normalizeHttpRoute } from './normalize-route';

test('uses Express baseUrl + route.path template', () => {
  expect(
    normalizeHttpRoute({
      baseUrl: '/api',
      route: { path: '/users/:id' },
      url: '/users/123?active=1',
    }),
  ).toBe('/api/users/:id');
});

test('uses Express route.path when baseUrl is absent', () => {
  expect(
    normalizeHttpRoute({
      route: { path: '/users/:id' },
      url: '/users/123',
    }),
  ).toBe('/users/:id');
});

test('prefers Express route template over the concrete URL', () => {
  expect(
    normalizeHttpRoute({
      route: { path: '/orders/:orderId/items/:itemId' },
      originalUrl: '/orders/abc/items/99?expand=1',
      path: '/orders/abc/items/99',
      url: '/orders/abc/items/99?expand=1',
    }),
  ).toBe('/orders/:orderId/items/:itemId');
});

test('uses Fastify routeOptions.url template (v4.10+ / v5)', () => {
  expect(
    normalizeHttpRoute({
      method: 'GET',
      url: '/users/123?active=1',
      routeOptions: { url: '/users/:id', method: 'GET' },
    }),
  ).toBe('/users/:id');
});

test('uses Fastify routerPath template when routeOptions is absent (v3 / early v4)', () => {
  expect(
    normalizeHttpRoute({
      method: 'GET',
      url: '/users/123',
      routerPath: '/users/:id',
    }),
  ).toBe('/users/:id');
});

test('prefers Fastify routeOptions.url over deprecated routerPath', () => {
  expect(
    normalizeHttpRoute({
      routerPath: '/legacy/:id',
      routeOptions: { url: '/users/:id' },
      url: '/users/42',
    }),
  ).toBe('/users/:id');
});

test('keeps Fastify prefix in the registered template', () => {
  expect(
    normalizeHttpRoute({
      url: '/v1/users/42',
      routeOptions: { url: '/v1/users/:id' },
    }),
  ).toBe('/v1/users/:id');
});

test('falls back to originalUrl pathname without query when no template exists', () => {
  expect(
    normalizeHttpRoute({
      originalUrl: '/static/healthz?ready=1',
      url: '/static/healthz?ready=1',
    }),
  ).toBe('/static/healthz');
});

test('falls back to Express path when originalUrl is missing', () => {
  expect(normalizeHttpRoute({ path: '/ready' })).toBe('/ready');
});

test('falls back to Fastify url pathname without query when no template exists', () => {
  expect(
    normalizeHttpRoute({
      url: '/unregistered/path?x=1#frag',
      routeOptions: {},
    }),
  ).toBe('/unregistered/path');
});

test('extracts pathname from an absolute URL fallback', () => {
  expect(
    normalizeHttpRoute({
      url: 'http://localhost:3000/users/1?q=1',
    }),
  ).toBe('/users/1');
});

test('returns unmatched when the request has no usable path', () => {
  expect(normalizeHttpRoute(undefined)).toBe('unmatched');
  expect(normalizeHttpRoute(null)).toBe('unmatched');
  expect(normalizeHttpRoute({})).toBe('unmatched');
  expect(
    normalizeHttpRoute({
      route: { path: '' },
      routerPath: '   ',
      routeOptions: { url: '' },
      url: '',
    }),
  ).toBe('unmatched');
});

test('does not treat a non-string Express route.path as a template', () => {
  expect(
    normalizeHttpRoute({
      route: { path: /^\/users\/.+/ },
      url: '/users/123',
    }),
  ).toBe('/users/123');
});
