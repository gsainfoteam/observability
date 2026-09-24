import { IncomingMessage, RequestOptions } from 'node:http';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

import {
  applyHttpRouteOnIncomingSpan,
  stashHttpServerSpan,
} from './otel/http-route-span';

export type OTelConfig = {
  serviceName: string;
  otlpEndpoint: string;
  metricsPort: number;
  apiUrl?: string;
  ignorePatterns?: string[];
  ignoreIncomingDomains?: string[];
};

const DEFAULT_IGNORE_PATTERNS = ['/health', '/metrics'] as const;

let prometheusExporter: PrometheusExporter | null = null;
let sdk: NodeSDK | null = null;

function normalizePath(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      const parsedUrl = new URL(path);
      return `${parsedUrl.pathname}${parsedUrl.search}`;
    } catch {
      return path;
    }
  }

  return path;
}

function extractOutgoingPath(request: unknown): string | undefined {
  if (typeof request === 'string') {
    return request;
  }

  if (request instanceof URL) {
    return `${request.pathname}${request.search}`;
  }

  if (!request || typeof request !== 'object') {
    return undefined;
  }

  const options = request as RequestOptions;

  if (typeof options.path === 'string') {
    return options.path;
  }

  const optionsWithExtras = options as RequestOptions & {
    pathname?: unknown;
    href?: unknown;
  };

  if (typeof optionsWithExtras.pathname === 'string') {
    return optionsWithExtras.pathname;
  }

  if (typeof optionsWithExtras.href === 'string') {
    return optionsWithExtras.href;
  }

  return undefined;
}

function isNoisePath(
  path?: string,
  ignorePatterns: readonly string[] = DEFAULT_IGNORE_PATTERNS,
): boolean {
  const normalizedPath = normalizePath(path);

  if (!normalizedPath) {
    return false;
  }

  const [pathname = ''] = normalizedPath.split('?');
  const canonicalPath = pathname.replace(/\/+$/, '') || '/';

  return ignorePatterns.some((noisePath) => canonicalPath === noisePath);
}

function isIgnoredIncomingDomain(
  url?: string,
  ignoreDomains: readonly string[] = [],
): boolean {
  if (!url || ignoreDomains.length === 0) {
    return false;
  }

  const normalizedPath = normalizePath(url);
  if (!normalizedPath) {
    return false;
  }

  const [pathname = ''] = normalizedPath.split('?');
  const canonicalPath = pathname.replace(/\/+$/, '') || '/';

  return ignoreDomains.some((domain) => canonicalPath === domain);
}

let startPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;

export const initializeOpenTelemetry = async (
  config: OTelConfig,
): Promise<void> => {
  if (!startPromise) {
    startPromise = Promise.resolve(
      (async () => {
        prometheusExporter = new PrometheusExporter({
          port: config.metricsPort,
          endpoint: '/metrics',
        });

        sdk = new NodeSDK({
          resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: config.serviceName,
          }),
          traceExporter: new OTLPTraceExporter({
            url: config.otlpEndpoint,
          }),
          metricReader: prometheusExporter,
          instrumentations: [
            getNodeAutoInstrumentations({
              '@opentelemetry/instrumentation-http': {
                ignoreIncomingRequestHook: (req: IncomingMessage) => {
                  if (isNoisePath(req.url, config.ignorePatterns)) {
                    return true;
                  }
                  return isIgnoredIncomingDomain(
                    config.apiUrl,
                    config.ignoreIncomingDomains,
                  );
                },
                ignoreOutgoingRequestHook: (request: unknown) => {
                  return isNoisePath(
                    extractOutgoingPath(request),
                    config.ignorePatterns,
                  );
                },
                // requestHook is too early to set http.route (Fastify has not
                // matched yet) but can stash the SERVER span for the interceptor.
                requestHook: (span, request) => {
                  stashHttpServerSpan(request, span);
                },
                applyCustomAttributesOnSpan: (span, request) => {
                  applyHttpRouteOnIncomingSpan(span, request);
                },
              },
            }),
            new PrismaInstrumentation(),
          ],
        });

        await sdk.start();
      })(),
    ).catch((error: unknown) => {
      startPromise = null;
      throw error;
    });
  }

  await startPromise;
};

export const shutdownOpenTelemetry = async (): Promise<void> => {
  if (!startPromise) {
    return;
  }

  await initializeOpenTelemetry({
    serviceName: '',
    otlpEndpoint: '',
    metricsPort: 0,
  }).catch(() => {
    // ignore re-initialization errors
  });

  if (!shutdownPromise) {
    let timeout: NodeJS.Timeout | null = null;

    shutdownPromise = Promise.race([
      sdk?.shutdown() ?? Promise.resolve(),
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`[otel] shutdown timeout after 10,000ms`));
        }, 10000);
      }),
    ])
      .catch((error: unknown) => {
        shutdownPromise = null;
        console.error('[otel] failed to shutdown sdk', error);
        throw error;
      })
      .finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
  }

  await shutdownPromise;
};
