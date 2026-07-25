# Checkout Service

> 🚧 **Work In Progress** — Only the project scaffold and its tooling are in place. No checkout logic has been implemented yet.

Checkout microservice for the Marketplace microservices architecture. Owns the checkout flow — turning a cart into an order and coordinating with payments — and persists its own state in PostgreSQL.

Part of the **marketplace-ms** study project, alongside the [api-gateway](https://github.com/viniciusferreira7/api-gateway) (synchronous HTTP entry point) and the [messaging-service](https://github.com/viniciusferreira7/messaging-service) (asynchronous event backbone).

## Stack

Built with [NestJS](https://nestjs.com/) 11 on Node.js, with [TypeORM](https://typeorm.io/) over PostgreSQL. Linting and formatting run on [Biome](https://biomejs.dev/); tests run on [Vitest](https://vitest.dev/).

Dependencies are installed but not wired up yet: `@nestjs/typeorm` + `pg` for persistence, `@nestjs/jwt` + `bcryptjs` for auth, and `undici` for outbound HTTP.

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) 11+
- PostgreSQL

## Running

```bash
# install dependencies
pnpm install

# development (watch mode)
pnpm start:dev

# production
pnpm build
pnpm start:prod
```

The service listens on `PORT` (default: `3000`).

## Scripts

| Script             | Description                          |
|--------------------|--------------------------------------|
| `pnpm start`       | Start the server                     |
| `pnpm start:dev`   | Start in watch mode                  |
| `pnpm start:debug` | Start in watch + debug mode          |
| `pnpm build`       | Compile to `dist/`                   |
| `pnpm lint`        | Lint and fix with Biome              |
| `pnpm check`       | Check formatting and lint with Biome |
| `pnpm check:fix`   | Format and lint-fix with Biome       |
| `pnpm check:type`  | Type-check with TypeScript           |
| `pnpm format`      | Format with Biome                    |
| `pnpm test:unit`   | Run the unit tests once              |
| `pnpm test:int`    | Run the integration tests            |
| `pnpm test:e2e`    | Run the end-to-end tests             |
| `pnpm test:watch`  | Run the unit lane in watch mode      |
| `pnpm test:cov`    | Run tests with coverage              |

## Testing

Tests run on [Vitest](https://vitest.dev/), split into three lanes that share a
base config (`vitest.shared.ts`). SWC handles the transform so NestJS decorator
metadata survives into the tests.

| Lane        | Config                  | Files            | Scope                                                      |
|-------------|-------------------------|------------------|------------------------------------------------------------|
| Unit        | `vitest.config.ts`      | `*.spec.ts`      | Pure and isolated — no app boot, no external infra          |
| Integration | `vitest.config.int.ts`  | `*.int-spec.ts`  | Modules wired through DI with real infra, below HTTP        |
| E2E         | `vitest.config.e2e.ts`  | `*.e2e-spec.ts`  | Full application booted and driven over HTTP                |

The integration and e2e lanes run serially with long timeouts. Only the unit and
e2e lanes have tests today — `pnpm test:int` exits non-zero until the first
`*.int-spec.ts` exists, which is Vitest's default "no test files found".

## Supply-chain hardening

Install-time policies live in `pnpm-workspace.yaml`:

| Setting                | Effect                                                              |
|------------------------|---------------------------------------------------------------------|
| `minimumReleaseAge`    | Rejects package versions published less than 7 days ago              |
| `strictDepBuilds`      | Fails the install on any dependency with an unreviewed build script  |
| `allowBuilds`          | Explicit allowlist of packages permitted to run build scripts        |
| `saveExact`            | Writes exact versions instead of ranges                              |
| `engineStrict`         | Fails when the local Node/pnpm does not satisfy `engines`            |
| `preferFrozenLockfile` | Installs from the lockfile as-is                                     |

Every entry in `allowBuilds` is currently set to `false` — no dependency runs build scripts. When a new one shows up, `pnpm install` fails and appends it to `pnpm-workspace.yaml` for review rather than executing it.

> Because of `minimumReleaseAge`, a freshly published version can fail to resolve with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Wait out the cooldown or add the version to `minimumReleaseAgeExclude`.

## Environment variables

Copy `.env.example` to `.env` and fill in the values. Every variable is validated
by a Zod schema (`src/env/env.ts`) when `ConfigModule` boots, so the app fails
fast on misconfiguration instead of crashing later. `EnvService` exposes them
with the types inferred from that schema.

| Variable       | Description                             | Required |
|----------------|-----------------------------------------|----------|
| `NODE_ENV`     | `dev` \| `test` \| `production`         | No (`dev`) |
| `PORT`         | HTTP port                               | No (`3334`) |
| `DATABASE_URL` | PostgreSQL connection string            | Yes      |
| `JWT_SECRET`   | Secret for JWT signing/verification     | Yes      |
| `RABBITMQ_URL` | AMQP connection string for the broker   | Yes      |

`.env.test` holds throwaway values so the test lanes can boot the application;
it is loaded ahead of `.env` and must never contain real credentials.

## Roadmap

- [ ] TypeORM data source, entities, and migrations
- [ ] Checkout domain: cart → order
- [ ] Integration with the payments service
- [ ] Publish and consume domain events via the messaging service
- [ ] Authentication and authorization
- [ ] Swagger/OpenAPI docs
- [ ] Test coverage beyond the scaffold

## Related repositories

| Repository | Description |
|------------|-------------|
| [api-gateway](https://github.com/viniciusferreira7/api-gateway) | Central HTTP entry point for the Marketplace microservices |
| [messaging-service](https://github.com/viniciusferreira7/messaging-service) | Asynchronous messaging backbone (RabbitMQ) |
