import {
  ClassSerializerInterceptor,
  Injectable,
  type ClassSerializerInterceptorOptions,
  type PlainLiteralObject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { setSpanError } from './span-error.util';

@Injectable()
export class OtelClassSerializerInterceptor extends ClassSerializerInterceptor {
  private readonly tracer = trace.getTracer('class-serializer');

  constructor(
    reflector: Reflector,
    defaultOptions?: ClassSerializerInterceptorOptions,
  ) {
    super(reflector, defaultOptions);
  }

  /**
   * Delegate to Nest's `serialize` unchanged. Only wrap the call with a span.
   */
  public override serialize(
    response: PlainLiteralObject | Array<PlainLiteralObject>,
    options: Parameters<ClassSerializerInterceptor['serialize']>[1],
  ): ReturnType<ClassSerializerInterceptor['serialize']> {
    const span = this.tracer.startSpan('nest.response.serialize');
    try {
      const result = super.serialize(response, options);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      setSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  }
}
