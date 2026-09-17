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

### 2. Use Tracing Decorator

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

### 3. Record Metrics

Use the exported metric adapters to record application metrics:

```typescript
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestErrorsTotal,
  dbQueriesTotal,
  dbQueryDurationSeconds,
} from '@gsainfoteam/nest-observability';

// In HTTP interceptor
httpRequestsTotal.add(1, { method: 'GET', route: '/users', status_code: 200 });
httpRequestDurationSeconds.record(0.125, { method: 'GET', route: '/users', status_code: 200 });

// In DB query interceptor
dbQueriesTotal.add(1, { operation: 'find', model: 'User' });
dbQueryDurationSeconds.record(0.025, { operation: 'find', model: 'User' });
```

### 4. Use Serializer Interceptor

Apply the observability-aware serializer interceptor:

```typescript
import { OtelClassSerializerInterceptor } from '@gsainfoteam/nest-observability';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: OtelClassSerializerInterceptor,
    },
  ],
})
export class AppModule {}
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

## Metrics Exported

- **httpRequestsTotal** - Total HTTP requests counter
- **httpRequestDurationSeconds** - HTTP request duration histogram
- **httpRequestsInFlight** - Current in-flight requests gauge
- **httpRequestErrorsTotal** - Failed HTTP requests counter
- **dbQueriesTotal** - Total database queries counter
- **dbQueryDurationSeconds** - Database query duration histogram

## Utilities

- `@Trace()` - Class decorator for automatic span creation on all methods
- `OtelClassSerializerInterceptor` - NestJS response serialization with tracing
- `setSpanError()` - Utility for recording errors in spans
- `startHttpRequestDurationTimer()` - Helper for measuring HTTP request duration
