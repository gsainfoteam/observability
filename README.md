# @gsainfoteam/nest-observability

NestJS observability toolkit for comprehensive monitoring, logging, and tracing capabilities.

## Installation

```bash
bun install @gsainfoteam/nest-observability
```

## Development

To install dependencies:

```bash
bun install
```

To run development mode:

```bash
bun run dev
```

To build:

```bash
bun run build
```

To test:

```bash
bun run test
```

## Usage

### 1. Initialize OpenTelemetry (in `main.ts`, before app bootstrap)

```typescript
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { initializeOpenTelemetry, initializeMetrics } from '@gsainfoteam/nest-observability';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    // Initialize OpenTelemetry SDK (must be before app creation)
    await initializeOpenTelemetry({
      serviceName: process.env.OTEL_SERVICE_NAME || 'my-service',
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      metricsPort: parseInt(process.env.METRICS_PORT || '9464'),
      apiUrl: process.env.API_URL,
      ignorePatterns: ['/health', '/metrics'], // Optional, defaults shown
      ignoreIncomingDomains: ['example.com'], // Optional: domains to filter out
    });

    // Initialize metrics
    initializeMetrics(process.env.OTEL_SERVICE_NAME || 'my-service');

    // Create and start NestJS app
    const app = await NestFactory.create(AppModule);
    await app.listen(process.env.PORT ?? 3000);
  } catch (error) {
    logger.error('Failed to bootstrap application', error);
    process.exit(1);
  }
}

bootstrap();
```

### 2. Register Metrics Interceptor

Register the built-in HTTP metrics interceptor (in `main.ts`):

```typescript
import { MetricsInterceptor } from '@gsainfoteam/nest-observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Register metrics interceptor
  app.useGlobalInterceptors(new MetricsInterceptor());
  
  await app.listen(process.env.PORT ?? 3000);
}
```

This automatically records:
- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request duration
- `http_requests_in_flight` - Currently in-flight requests
- `http_request_errors_total` - Failed requests with error details

HTTP metrics use a `route` label. The interceptor prefers the **matched route template** (for example `/users/:id`) over the concrete URL so path parameters do not explode Prometheus cardinality. This works for both Nest adapters:

- Express: `req.baseUrl` + `req.route.path`
- Fastify: `req.routeOptions.url` (Fastify 4.10+/5) or `req.routerPath` (older Fastify)

If no string route template is available, the label is `unmatched`. Concrete request paths (`url`, `path`, `originalUrl`) are never used as labels.

The same template is written to inbound HTTP **server** spans as `http.route`, and the span name is updated (for example `GET /users/:id`) so Tempo/Grafana show a stable path. HTTP `requestHook` runs before Fastify matches a route, so it only stashes the SERVER span; `MetricsInterceptor` then sets `http.route` after routing. If no template is available, `http.route` is `unmatched` rather than a concrete path with IDs.

### 3. Register Prisma Metrics Service (Optional)

For database query metrics, register the Prisma metrics service:

```typescript
import { Module } from '@nestjs/common';
import { PrismaMetricsService } from '@gsainfoteam/nest-observability';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService, PrismaMetricsService],
})
export class DatabaseModule {
  constructor(
    private prisma: PrismaService,
    private metrics: PrismaMetricsService,
  ) {
    this.prisma.$on('query', this.metrics.getMetricsMiddleware());
  }
}
```

This automatically records:
- `db_queries_total` - Total database queries by operation and model
- `db_query_duration_seconds` - Query duration histogram

### 4. Use Tracing Decorator

Add `@Trace()` decorator to your service methods for automatic span creation:

```typescript
import { Injectable } from '@nestjs/common';
import { Trace } from '@gsainfoteam/nest-observability';

@Injectable()
@Trace()
export class UserService {
  async getUser(id: string) {
    // Automatically creates span: UserService.getUser
    return { id, name: 'John Doe' };
  }
}
```

### 5. Use Serializer Interceptor (Optional)

Apply the observability-aware serializer interceptor for response serialization tracing:

```typescript
import { OtelClassSerializerInterceptor } from '@gsainfoteam/nest-observability';
import { Reflector } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const reflector = app.get(Reflector);
  
  // Register serializer interceptor (requires Reflector dependency)
  app.useGlobalInterceptors(new OtelClassSerializerInterceptor(reflector));
  
  await app.listen(process.env.PORT ?? 3000);
}
```

## Configuration

### OTelConfig Interface

```typescript
type OTelConfig = {
  serviceName: string;              // Required: Service identifier
  otlpEndpoint: string;             // Required: OTLP collector endpoint
  metricsPort: number;              // Required: Prometheus metrics port
  apiUrl?: string;                  // Optional: API URL for filtering
  ignorePatterns?: string[];        // Optional: Paths to ignore (default: ['/health', '/metrics'])
  ignoreIncomingDomains?: string[]; // Optional: Domains to filter out
};
```

## Environment Variables

```bash
OTEL_SERVICE_NAME=my-service
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
METRICS_PORT=9464
API_URL=https://api.example.com
```

## Provided Interceptors & Services

- **MetricsInterceptor** - Automatic HTTP metrics collection
- **PrismaMetricsService** - Database query metrics for Prisma ORM
- **OtelClassSerializerInterceptor** - Response serialization with tracing
- **@Trace()** - Class decorator for automatic method-level span creation

## Built-in Metrics

The package automatically collects the following metrics when interceptors are registered:

### HTTP Metrics
- `http_requests_total` - Total HTTP requests (labels: method, route, status_code)
- `http_request_duration_seconds` - Request duration histogram (labels: method, route, status_code)
- `http_requests_in_flight` - Current in-flight requests (labels: method, route)
- `http_request_errors_total` - Failed requests (labels: method, route, error_name, status_code)

### Database Metrics (with PrismaMetricsService)
- `db_queries_total` - Total database queries (labels: operation, model)
- `db_query_duration_seconds` - Query duration histogram (labels: operation, model)
