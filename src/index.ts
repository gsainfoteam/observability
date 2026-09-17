// SDK Initialization
export { initializeOpenTelemetry, shutdownOpenTelemetry } from './otel';
export type { OTelConfig } from './otel';

// Metrics
export {
  initializeMetrics,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  startHttpRequestDurationTimer,
  httpRequestsInFlight,
  httpRequestErrorsTotal,
  dbQueryDurationSeconds,
  dbQueriesTotal,
} from './metrics';

// OTEL Utilities
export { Trace } from './otel/trace.decorator';
export { OtelClassSerializerInterceptor } from './otel/otel-class-serializer.interceptor';
export { setSpanError } from './otel/span-error.util';
