import { test, expect } from 'bun:test';

// 패키지 임포트 테스트
test('should export OpenTelemetry initialization functions', async () => {
  const module = await import('./index');

  expect(module.initializeOpenTelemetry).toBeDefined();
  expect(module.shutdownOpenTelemetry).toBeDefined();
  expect(module.initializeMetrics).toBeDefined();
  expect(module.MetricsInterceptor).toBeDefined();
  expect(module.PrismaMetricsService).toBeDefined();
  expect(module.Trace).toBeDefined();
  expect(module.OtelClassSerializerInterceptor).toBeDefined();
  expect(module.setSpanError).toBeDefined();
});

test('MetricsInterceptor should be instantiable', async () => {
  const { MetricsInterceptor } = await import('./index');
  const interceptor = new MetricsInterceptor();

  expect(interceptor).toBeDefined();
  expect(typeof interceptor.intercept).toBe('function');
});

test('should export OTelConfig type', async () => {
  const module = await import('./otel');

  expect(module).toBeDefined();
});
