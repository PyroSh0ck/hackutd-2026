@AGENTS.md

# Hackathon starter: how to work here

Next.js 16 (App Router, Cache Components) · React 19 · Prisma 7 + Neon · Better Auth · Zod 4 ·
React Hook Form · Vitest + Testing Library · Playwright. Read `docs/BASELINE.md` "Rules learned" once.

## Building features

The starter has **no feature code to copy**. The generator is the reference implementation.

1. Turn the brief into a plan + specs first: use the `plan-app` skill.
2. Resources, relations (`belongsTo`), and stats dashboards are **generated**: use the `build-feature`
   skill (`pnpm gen specs/<name>.json --verify`). Spec reference: `generator/README.md`; working
   examples: `generator/examples/`.
3. Everything else starts from `pnpm gen route <name>` (authenticated endpoint scaffold + tests).
   To see how anything is done, `pnpm gen preview generator/examples/<x>.json <path-filter>`.

## Architecture boundaries

- `src/contracts/*` Zod schemas are the single source of request/response truth (client + server).
- Route handlers use `authRoute()` + `readJson`/`parseInput`/`parseQuery`/`parseId` from
  `src/server/http/route.ts`. Never hand-roll auth, error envelopes, or request IDs.
- Services take `ownerId` from the session and filter every query by it. Clients never send ownerId.
  Not-owned and malformed ids → 404.
- UI uses `src/components/{ui,forms,patterns,layouts,advanced}` public props only. No `className`/`style`
  on kit components, no new colors/spacing in feature code. Visual problems are fixed in the shared
  component or reported to the designer, not patched per feature.
- Client data: `apiRequest` (`src/lib/api-client.ts`), lists via `useResourceList`, forms via RHF +
  `validatePayload`/`applyServerErrors` (`src/lib/form-errors.ts`).

## File ownership

| Path | Owner | Rule |
| --- | --- | --- |
| `visual-design/**` | Designer | Never edit. Describe needed visual changes instead. (hook-enforced) |
| `src/components/**` | Shared | Keep public props stable; additive changes only, and mention them. |
| Generated feature files | You (after generation) | Edit freely; `pnpm gen` won't overwrite edited files. |
| `generator/**` (templates, examples) | Shared | Only change when asked to work on the generator; then run `node scripts/generator-smoke.mjs`. |
| `generator/manifest.json`, `src/generated/**`, applied migrations | Tools | Never hand-edit. (hook-enforced) |
| `tests/helpers/owned-resource.ts` | Trusted | Never weaken. Ask before changing. (hook-enforced) |

## Next.js 16 gotchas (observed in this repo)

- No hard-coded DOM ids: hidden previous routes stay mounted; use `useId()`.
- Server pages must not pass functions to client components (build-time failure only).
- Dynamic `params` are awaited in an async child inside `<Suspense>`.
- Don't add `export const runtime = "nodejs"` to routes (incompatible with Cache Components).

## Tooling (observed in trials)

Run one command per Bash call (no `;`/`&&` chains, no `for` loops, no `$?`), and create or append files
with the Write/Edit tools rather than heredocs: compound shell commands often need extra approval.

## Databases

`.env.local` (dev, `pnpm dev`, `db:migrate:dev`) and `.env.test.local` (testing branch, all
Playwright tests, `db:migrate:test`). Never run `migrate reset`/`db push`. Don't read env files.

## Verification (report real exit codes; never claim a check you didn't run)

| When | Command | Time |
| --- | --- | --- |
| Per edit | automatic ESLint on the edited file (hook) | ~2s |
| After generating/changing a feature | `pnpm check` (lint + typecheck + unit/component) | ~15s |
| Feature complete | `pnpm exec playwright test tests/api/<x>.spec.ts tests/e2e/<x>.spec.ts` | ~40s |
| Before handing off | `pnpm test:integration` (all API + E2E, builds prod on :3100) | ~2–3 min |

The Stop hook runs `pnpm check` when the tree changed and records `.claude/evidence/last-check.json`.
Integration tests are never run by hooks: run them yourself at the milestones above.

Final reports list: what was built, files touched, commands run with pass/fail counts, anything
skipped or failing (with reason), and assumptions the user should confirm.
