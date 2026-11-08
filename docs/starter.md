# Starter setup

## Stack

- Next.js App Router with TypeScript
- pnpm
- Tailwind CSS
- Prisma 7 with the Neon adapter
- Neon PostgreSQL
- Better Auth email/password authentication
- Zod contracts
- React Hook Form
- Pino logging
- Vitest and Testing Library
- Playwright
- Vercel deployment

Exact dependency versions are recorded in package.json and pnpm-lock.yaml.

## Environment files

.env.local:

- DATABASE_URL
- DATABASE_URL_UNPOOLED
- BETTER_AUTH_SECRET
- BETTER_AUTH_URL
- LOG_LEVEL
- DEMO_USER_EMAIL

.env.test.local:

- DATABASE_URL
- DATABASE_URL_UNPOOLED
- BETTER_AUTH_SECRET
- BETTER_AUTH_URL=<http://127.0.0.1:3100>

The two database URLs in each file must refer to the same Neon branch.
Tests use the testing branch.

The current deployment shares the development database.
Local data changes can therefore affect the deployed app.

Never commit environment files containing secrets.

## Fresh checkout

1. Use the Node version recorded in .nvmrc.
2. Install the pnpm version recorded in package.json.
3. Run pnpm install --frozen-lockfile.
4. Configure .env.local and .env.test.local.
5. Run pnpm exec prisma migrate deploy.
6. Run pnpm exec prisma generate.
7. Run pnpm exec prisma migrate deploy --config prisma.test.config.ts.
8. Start the app and register the demo account if it does not exist.
9. Set DEMO_USER_EMAIL and run pnpm db:seed.
10. Stop the dev server and run pnpm verify.

## Commands

- pnpm dev: local development
- pnpm db:seed: prepare demo projects
- pnpm demo:restore: restore the three demo projects
- pnpm check: lint, types, unit and component tests
- pnpm test:integration: API and browser tests
- pnpm verify: full verification
- pnpm test:report: open the latest browser test report
- pnpm gen <spec.json> [--dry-run|--verify|--force]: generate a feature (see generator/README.md)
- pnpm gen check <spec.json> / pnpm gen remove <name>
- pnpm db:migrate:dev --name <x>: create + apply a migration on the .env.local database
- pnpm db:migrate:test: apply migrations to the testing branch
- node scripts/trial.mjs ...: controlled Claude trials (see trials/README.md)

## Where things live

- `visual-design/`: designer-owned CSS modules, tokens, button artwork (imported via `@visual/*`).
- `src/components/`: shared UI behavior and public APIs. Galleries at /playground (dev only).
- `generator/` + `specs/`: feature generator and the specs it was run on.
- `CLAUDE.md`, `.claude/`: Claude instructions, skills (plan-app, build-feature), hooks.

## Application conventions

- Shared request and response schemas live in src/contracts.
- Route handlers authenticate and validate requests.
- Services require an ownerId from the authenticated session.
- Clients never choose ownerId.
- Database queries filter by ownerId.
- Server implementation lives under src/server.
- Feature-specific UI lives under src/features.
- Reusable layout components live under src/components/layouts (AppShell + kit layouts).
- API errors include a code, message, and requestId.

## Authentication deployment

Production origin:
<https://claude-configuration-testing.vercel.app>

BETTER_AUTH_URL must match the intended app origin.
Use the production domain when manually testing production auth.
E2E_TEST is supplied only to the local Playwright server.

## Demo data

The demo account is created through Better Auth registration.
The seed script restores three fixed projects for DEMO_USER_EMAIL.
It preserves other records and does not reset account passwords.

## Known issue

Playwright previously triggered continuous Fast Refresh reloads
against the development server. The cause has not been identified.
Integration tests now use a local production build.
