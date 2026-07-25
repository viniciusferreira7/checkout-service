/**
 * Environment defaults for the lanes that boot the Nest application
 * (integration and e2e). `.env.test` is gitignored, so without this a fresh
 * clone or a CI run would fail the Zod validation in `src/env/env.ts`.
 *
 * These are throwaway values — never put real credentials here. Anything
 * already present in `process.env` wins, so CI can override any of them.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3334',
  DATABASE_URL: 'postgres://test:test@localhost:5432/checkout_test',
  JWT_SECRET: 'test-secret',
  RABBITMQ_URL: 'amqp://test:test@localhost:5672',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
