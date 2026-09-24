import 'reflect-metadata';

import { ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { expect, test } from 'bun:test';
import { Exclude, Expose } from 'class-transformer';
import { firstValueFrom, of } from 'rxjs';

import { OtelClassSerializerInterceptor } from './otel-class-serializer.interceptor';

class UserResponseDto {
  name = 'Ada Lovelace';

  @Exclude()
  password = 'secret';

  @Expose()
  get initials(): string {
    return this.name
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('');
  }
}

function createExecutionContext() {
  return {
    getHandler: () => function handler() {},
    getClass: () => class UsersController {},
  };
}

test('OtelClassSerializerInterceptor matches Nest serialize for @Exclude and getters', () => {
  const reflector = new Reflector();
  const nest = new ClassSerializerInterceptor(reflector);
  const otel = new OtelClassSerializerInterceptor(reflector);
  const dto = new UserResponseDto();

  const nestPlain = nest.serialize(dto, {});
  const otelPlain = otel.serialize(dto, {});

  expect(otelPlain).toEqual(nestPlain);
  expect(otelPlain).toEqual({
    name: 'Ada Lovelace',
    initials: 'AL',
  });
  expect(otelPlain).not.toHaveProperty('password');
});

test('OtelClassSerializerInterceptor forwards defaultOptions like Nest', () => {
  const reflector = new Reflector();
  const defaultOptions = { excludeExtraneousValues: true };
  const nest = new ClassSerializerInterceptor(reflector, defaultOptions);
  const otel = new OtelClassSerializerInterceptor(reflector, defaultOptions);
  const dto = new UserResponseDto();

  const context = createExecutionContext();

  return Promise.all([
    firstValueFrom(
      nest.intercept(context as never, { handle: () => of(dto) }),
    ),
    firstValueFrom(
      otel.intercept(context as never, { handle: () => of(dto) }),
    ),
  ]).then(([nestPlain, otelPlain]) => {
    expect(otelPlain).toEqual(nestPlain);
    expect(otelPlain).toEqual({ initials: 'AL' });
    expect(otelPlain).not.toHaveProperty('password');
    expect(otelPlain).not.toHaveProperty('name');
  });
});
