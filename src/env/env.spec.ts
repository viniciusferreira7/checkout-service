import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

const baseEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/checkout',
  JWT_SECRET: 'secret',
  JWT_EXPIRES_IN: '1s',
  RABBITMQ_URL: 'amqp://admin:admin@localhost:5672',
};

describe('envSchema', () => {
  it('applies the NODE_ENV and PORT defaults', () => {
    const env = envSchema.parse(baseEnv);

    expect(env.NODE_ENV).toBe('dev');
    expect(env.PORT).toBe(3334);
  });

  it('coerces PORT from a string', () => {
    const env = envSchema.parse({ ...baseEnv, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it('accepts a postgres connection string', () => {
    expect(envSchema.parse(baseEnv).DATABASE_URL).toBe(baseEnv.DATABASE_URL);
  });

  it('accepts an amqp connection string', () => {
    expect(envSchema.parse(baseEnv).RABBITMQ_URL).toBe(baseEnv.RABBITMQ_URL);
  });

  it('rejects an invalid DATABASE_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, DATABASE_URL: 'not-a-url' })
    ).toThrow();
  });

  it('rejects an invalid RABBITMQ_URL', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, RABBITMQ_URL: 'not-a-url' })
    ).toThrow();
  });

  it('rejects an empty JWT_SECRET', () => {
    expect(() => envSchema.parse({ ...baseEnv, JWT_SECRET: '' })).toThrow();
  });

  it('rejects an empty JWT_EXPIRES_IN', () => {
    expect(() => envSchema.parse({ ...baseEnv, JWT_EXPIRES_IN: '' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      envSchema.parse({ ...baseEnv, NODE_ENV: 'staging' })
    ).toThrow();
  });
});
