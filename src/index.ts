// SDK Initialization
export { initializeOpenTelemetry, shutdownOpenTelemetry } from './otel';
export type { OTelConfig } from './otel';

// Metrics
export { initializeMetrics } from './metrics';

// Metrics Interceptors & Services
export { MetricsInterceptor } from './metrics/metrics.interceptor';
export { PrismaMetricsService } from './metrics/prisma-metrics.service';
export type { PrismaQueryEvent } from './metrics/prisma-metrics.service';

// OTEL Utilities
export { Trace } from './otel/trace.decorator';
export { OtelClassSerializerInterceptor } from './otel/otel-class-serializer.interceptor';
export { setSpanError } from './otel/span-error.util';
export { registerFastifyHttpRouteHook } from './otel/http-route-span';
