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

Import the `ObservabilityModule` in your NestJS application:

```typescript
import { Module } from '@nestjs/common';
import { ObservabilityModule } from '@gsainfoteam/nest-observability';

@Module({
  imports: [ObservabilityModule],
})
export class AppModule {}
```
