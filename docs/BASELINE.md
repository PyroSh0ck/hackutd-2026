# Baseline — 2026-11-04 (branch starter/feature-generator)

Observed before any changes (commit 91e64d0 + user's uncommitted radix-ui/lucide-react install):

| Check | Result |
| --- | --- |
| `pnpm lint` | 0 errors, 1 warning (`window.location.assign` in auth-form.tsx) |
| `pnpm typecheck` | pass |
| `pnpm test` | 8/8 pass (2 files) |
| `pnpm build` | pass |

Versions confirmed in package.json: next 16.4.4, react 19.3.0, prisma 7.10.1, better-auth 1.7.15,
zod ^4.6.7, vitest ^5.1.0, @playwright/test ^1.64.1, radix-ui 1.8.1, lucide-react 1.67.0, pnpm 12.16.1.

Differences from the handoff: none material. Component kit was not merged (confirmed). No `.claude/`
or CLAUDE.md existed. Build warns about a stray `~/pnpm-workspace.yaml` outside the repo (harmless).

## After Phase 1 (kit merge)

- Kit behavior in `src/components/{ui,forms,patterns,layouts,advanced}`; visuals in `visual-design/`
  via `@visual/*` alias. Galleries at `/playground` and `/playground/advanced` (404 in production).
- `pnpm test`: 33/33 (8 app + 25 kit). typecheck pass. lint 0 errors, 3 warnings (2 new `<img>` in
  file-upload/image-carousel — intentional for arbitrary user previews). `pnpm build` pass.

## After Phase 2 (Projects reference feature) — 2026-11-04 09:40

- `pnpm check`: pass (lint 0 errors/3 warnings, typecheck pass, 58/58 unit+component).
- `pnpm test:integration` against the Neon testing branch: 20/20 API+E2E pass (last full run
  19/20, then the one failing E2E fixed and re-run 5/5 green).
- Mutation check: removing `ownerId` from getProject/updateProject makes the cross-user invariant
  fail (Expected 404, Received 200). Reverted.

## Rules learned (feed into generator templates and CLAUDE.md)

1. **No hard-coded DOM ids** in feature components. Next 16 + Cache Components keeps previous
   routes mounted in hidden `<Activity>`, so fixed ids collide across routes (observed: textbox
   name "Name Name *"). Use `useId()` or let kit fields generate ids.
2. **Server pages must not pass functions to client components** (render props). Typecheck passes;
   only `next build` prerender fails. Pass plain elements.
3. **Tests locate fields by role**: `getByRole("textbox", { name })`, not `getByLabel(exact)` —
   required-field labels contain an aria-hidden " *".
4. **Turbopack Tailwind rule must exclude `*.module.css`**, or CSS modules silently lose scoping.
   jsdom tests cannot catch this; the E2E CSS-module smoke test does.
5. Dynamic route params are awaited in an async child inside `<Suspense>` (Cache Components).
