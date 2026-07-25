# Checkout Service

> 🚧 **Work In Progress** — Only the project scaffold and its tooling are in place. No checkout logic has been implemented yet.

Checkout microservice for the Marketplace microservices architecture. Owns the checkout flow — turning a cart into an order and coordinating with payments — and persists its own state in PostgreSQL.

Part of the **marketplace-ms** study project, alongside the [api-gateway](https://github.com/viniciusferreira7/api-gateway) (synchronous HTTP entry point) and the [messaging-service](https://github.com/viniciusferreira7/messaging-service) (asynchronous event backbone).

## Stack

Built with [NestJS](https://nestjs.com/) 11 on Node.js, with [TypeORM](https://typeorm.io/) over PostgreSQL. Linting and formatting run on [Biome](https://biomejs.dev/); tests run on [Jest](https://jestjs.io/).

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
| `pnpm test`        | Run the unit tests once              |
| `pnpm test:watch`  | Run tests in watch mode              |
| `pnpm test:cov`    | Run tests with coverage              |
| `pnpm test:e2e`    | Run the end-to-end tests             |

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

## Roadmap

- [ ] Environment validation (Zod schema) with fail-fast startup
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
