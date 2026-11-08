---
name: build-feature
description: Build features in this starter with the generator, then verify them end to end. Use for any user-owned data feature ("add tasks/expenses/notes/bookings", "users can save X", "X belongs to Y"), stats/dashboard pages, or custom endpoints, and when implementing items from docs/PLAN.md.
when_to_use: Adding or changing a CRUD resource, a relation between resources, a dashboard of counts/sums/averages, or any custom API action.
---

# Build a feature with the generator

The repo has no example feature code. The generator IS the reference: it emits the house pattern
(contract → Prisma model → service → route → client → form/list/panel/detail → page → tests).
Spec reference: [generator/README.md](../../../generator/README.md). Working specs of every kind:
`generator/examples/` (project, task, expense, bookmark, milestone, overview).

## Choose the tool

| Requirement | Tool |
| --- | --- |
| User-owned records with create/list (+ detail/update/delete) | resource spec |
| Record belongs to another record (task → project) | `belongsTo` field (generate the parent first) |
| Counts / sums / averages of the user's records | dashboard spec (`"kind": "dashboard"`) |
| Anything else (workflow, cross-resource action, integration, computed view) | `pnpm gen route <name>`, then implement the TODOs |

## Steps

1. **Write `specs/<name>.json`**, starting from the closest file in `generator/examples/`. Order:
   parents → children → dashboards. Prefer the smallest spec that meets the brief.
2. **Validate:** `pnpm gen check specs/<name>.json`. Fix every issue; don't work around them.
3. **Preview:** `pnpm gen specs/<name>.json --dry-run` (files + Prisma model). Exit 2 = conflict:
   read the reason. Never delete or rename user files to make room.
4. **Generate + verify:** `pnpm gen specs/<name>.json --verify`. Exit 3 = failed and rolled back.
   A failure inside generated code is a generator bug: report it, don't hand-patch the output.
5. **Migrate** (resources only): `pnpm db:migrate:dev --name add_<plural>` then `pnpm db:migrate:test`.
   Several specs can share one migration: generate them all, then migrate once.
6. **Test:** `pnpm check`, then `pnpm exec playwright test tests/api/<x>.spec.ts tests/e2e/<x>.spec.ts`.
7. **Customize** only what specs can't express, by editing generated files. Add assertions for new
   behavior to the generated tests. Re-run step 6.
8. **Report** using the format in CLAUDE.md, including which specs you wrote and why.

## Hand-writing code (custom routes and customizations)

- Start with `pnpm gen route <name> --verify` (or `pnpm gen preview route <name>` to read it first).
- To see how something is done (forms, lists, ownership checks, tests), run
  `pnpm gen preview generator/examples/<x>.json <path-filter>`, e.g. `... task.json service`.
- Rules: every Prisma query filters by `ownerId` from the session; ids the user doesn't own → 404;
  referenced ids the user doesn't own → 400 field error (`assertOwnedParent`); validate input with a
  strict Zod schema in `src/contracts`; use `authRoute`, `apiRequest`, kit components; no fixed DOM ids.
- Tests for custom routes must cover 401, invalid input, the real behavior, and another user's data
  never leaking.

## Changing a generated feature

- Spec change, files untouched: edit the spec, `--dry-run`, then `--force --verify`, new migration.
- Files edited: change them by hand (the generator refuses to overwrite; that is intended).
- Removing: `pnpm gen remove <name> --dry-run`, then without `--dry-run` (children first). Tables
  aren't dropped automatically; a new migration is needed for that.

## Not supported in v1

| Need | Approach |
| --- | --- |
| Many-to-many / tags | `text` field with comma-separated values, or a hand-written join model + custom route. |
| Status workflow, computed fields | Generate with an `enum`; enforce transitions/compute in the service; add API tests. |
| File upload | `FileUpload` component + custom route storing locally (no paid storage). |
| Public/shared data, admin views | Custom route; never loosen ownership on generated routes. |
| AI/chat | `ChatPanel` with a local mock adapter unless the user explicitly approves a paid API. |

If a requirement conflicts with the ownership model (client-chosen owner, records shared across
users), stop and ask the user instead of loosening checks.
