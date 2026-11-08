# Feature generator

Turns a validated JSON spec (`specs/<name>.json`) into an ordinary, typed, owner-scoped CRUD
feature: contract → Prisma model → service → route handlers → client API → form/list/panel/detail →
pages → tests. Output is plain TS/TSX you own and may edit.

The starter ships with **no feature code**. Specs you write go in `specs/`. Complete, tested examples
of every spec kind live in `generator/examples/` (copy one as a starting point).

```sh
pnpm gen check specs/task.json            # validate only
pnpm gen specs/task.json --dry-run        # list files + Prisma model; writes nothing
pnpm gen preview specs/task.json form     # print generated file(s) whose path contains "form"; writes nothing
pnpm gen specs/task.json --verify         # write, then prisma validate/generate + typecheck + lint + generated unit tests; rolls back on failure
pnpm gen specs/task.json --force          # regenerate files that are still byte-identical to what was generated
pnpm gen route weeklyReport --verify      # scaffold a custom authenticated endpoint (see "Custom routes")
pnpm gen preview route weeklyReport       # print that scaffold without writing
pnpm gen remove task [--dry-run]          # delete unmodified generated files + insertions (never touches the DB)
```

`pnpm gen preview` is the reference implementation: to hand-write something the generator can't
express, preview the closest spec and follow the same structure.

Exit codes: `0` ok · `1` invalid spec/usage · `2` conflicts (nothing written) · `3` verification failed (rolled back) · `4` write failed (rolled back).

After a successful run (the generator never touches a database):

```sh
pnpm db:migrate:dev --name add_<plural>   # dev DB from .env.local
pnpm db:migrate:test                      # testing branch from .env.test.local
pnpm check
pnpm exec playwright test tests/api/<plural>.spec.ts tests/e2e/<plural>.spec.ts
```

## Spec v1

```jsonc
{
  "version": 1,
  "name": "task",                 // lowerCamelCase singular, 1–30 chars; becomes model Task, prisma.task
  "plural": "tasks",              // lowerCamelCase; becomes /tasks, /api/tasks, src/features/tasks
  "label": "Task",                // UI text
  "pluralLabel": "Tasks",
  "description": "Optional page description.",
  "operations": ["create", "list", "detail", "update", "delete"],
  "ownership": "current-user",    // only value in v1
  "layout": "list-with-create-form",  // only value in v1 (detail page is added when "detail" is present)
  "fields": [ /* 1–20 fields, see below */ ],
  "list": { "titleField": "title", "searchFields": ["title"], "pageSize": 20 }
}
```

Unknown keys are rejected everywhere. There is deliberately no way to express paths, imports,
code, SQL, CSS, class names, or arbitrary JSX.

### Rules

- `operations` must include `create` and `list`; `update` requires `detail`. `delete` works with or without `detail`.
- `list.titleField` must be a **required `string`** field (it is the card/heading title).
- `list.searchFields` (max 4, default `[titleField]`): `string`/`text`/`email`/`url` fields; case-insensitive "contains" with OR.
- `list.pageSize`: 10, 20, or 50. Sort is always newest first.
- Reserved resource names: existing models/routes (`user`, `session`, `account`, `project`, `auth`, `api`, …) and JS keywords.
- Reserved field names: `id`, `ownerId`, `owner`, `createdAt`, `updatedAt`, `page`, `pageSize`, `q`, `data`, `meta`, `error`.
- Display text (`label`, `hint`, enum labels) allows letters, numbers, spaces and `. , ' ’ ( ) - / & ? ! : % # +` only.

### Field types

| type | options | stored as | DTO |
| --- | --- | --- | --- |
| `string` | `required`, `maxLength` (1–500, default 100) | `VARCHAR(n)` | `string` |
| `text` | `required`, `maxLength` (1–20000, default 2000) | `TEXT` | `string` |
| `email` | `required` | `VARCHAR(254)` | `string` |
| `url` | `required` (http/https only) | `VARCHAR(2048)` | `string` |
| `int` | `required`, `min`, `max`, `default` | `INTEGER` | `number` |
| `decimal` | `required`, `scale` (0–4, default 2), `min`, `max`, `default` | `DECIMAL(9+scale, scale)` | `number` |
| `boolean` | `default` (default `false`); **no `required`** | `BOOLEAN` | `boolean` |
| `date` | `required`, `min`, `max` (`YYYY-MM-DD`) | `DATE` | `"YYYY-MM-DD"` |
| `enum` | `required`, `values` (2–20 `{value: snake_case, label}`), `default` | `VARCHAR(40)` | union of values |
| `belongsTo` | `resource` (an already generated resource), `required`; `name` must end in `Id` | FK `TEXT` + relation | `string` id, plus `<relation>: {id, label}` |

All fields also accept `label` (default: humanized name) and `hint` (help text under the input).

### Optional / null semantics

- **nullable** = not required, no default (and not boolean). Create may omit it or send `null`/blank string → stored `NULL`; DTO type `T | null`. Update with `null` clears it.
- **required without default**: create must send a valid value.
- **with default** (`int`, `decimal`, `enum`, `boolean`): create may omit it → DB default applies; never null.
- Strings are trimmed. A required string of only spaces is rejected ("X is required.").
- Update (`PATCH`) accepts any subset of fields and rejects an empty body.

### Relations (`belongsTo`)

```json
{ "name": "projectId", "type": "belongsTo", "resource": "project", "required": true }
```

- Generate the parent first. The parent's model gets a back-relation line (its manifest hash is kept current).
- Required → deleting the parent deletes its children (cascade). Optional → the child's id becomes null.
- The service rejects a parent the user doesn't own, or that doesn't exist, with 400 and a field error.
- The DTO includes `project: { id, label }` (label = parent's title field). Lists accept `?projectId=<id>`.
- The form shows a select of the user's parent records (first 50, newest first).
- At most one `belongsTo` per parent resource; no self-relations in v1. A parent with children can't be removed.

## Dashboards (`"kind": "dashboard"`)

Per-user stats over generated resources. See `generator/examples/overview.json`.

```jsonc
{
  "version": 1, "kind": "dashboard", "name": "overview", "label": "Overview",
  "stats": [
    { "id": "openTasks", "label": "Tasks to do", "resource": "task", "aggregate": "count", "where": { "status": "todo" } },
    { "id": "spent", "label": "Total spent", "resource": "expense", "aggregate": "sum", "field": "amount" },
    { "id": "avgRating", "label": "Average rating", "resource": "bookmark", "aggregate": "avg", "field": "rating" }
  ]
}
```

- `aggregate`: `count` (no field), `sum`/`avg` (an `int` or `decimal` field). `avg` is null with no rows.
- `where`: equality on `boolean`/`enum` fields only. 1–8 stats. Values are rounded to 2 decimals.
- Generates `GET /api/<name>` returning `{ data: { <id>: number } }`, a `/<name>` page (DashboardLayout + StatCard),
  and tests (401, zeros for a new user, per-user aggregation with another user's data present).

## Custom routes (`pnpm gen route <name>`)

For anything specs can't express (workflows, cross-resource actions, integrations, computed views).
Scaffolds `src/contracts/<name>.ts`, `src/server/services/<name>-service.ts`, `src/app/api/<name>/route.ts`
(GET + POST via `authRoute`), `src/features/<name>/api.ts`, and `tests/api/<name>.spec.ts`
(401, malformed JSON, unknown keys, and a happy-path TODO). Replace every TODO; keep every query
filtered by `ownerId`, and add a test proving another user's data never leaks.

## What gets generated

```
src/contracts/<name>.ts                         Zod create/update/list/DTO schemas + types
prisma/models/<name>.prisma                     model with ownerId → User (cascade), index (ownerId, createdAt)
src/server/services/<name>-service.ts           owner-scoped Prisma CRUD
src/app/api/<plural>/route.ts                   GET list (page, pageSize, q) · POST create
src/app/api/<plural>/[id]/route.ts              GET · PATCH · DELETE (per operations)
src/features/<plural>/api.ts                    typed client calls
src/features/<plural>/components/*.tsx          form, list, panel (+ detail)
src/app/<plural>/page.tsx (+ [id]/page.tsx)     pages using AppShell + SessionGate + kit layouts
tests/unit/<name>-contract.test.ts              field boundary cases from the spec
tests/components/<plural>-panel.test.tsx        loading/empty/error/retry/validation/create
tests/api/<plural>.spec.ts                      owned-resource invariants + round-trip/defaults/nulls/search
tests/e2e/<plural>.spec.ts                      create → reload → open → edit → delete
```

Plus one line each after the markers in `prisma/schema.prisma` (`// generator:user-relations`)
and `src/config/navigation.ts` (`// generator:nav-items`). `generator/manifest.json` records a
hash of every generated file; edited files are never overwritten or removed.

## Proving the templates

`node scripts/generator-smoke.mjs` generates every example (and a custom route) with `--verify` in a
throwaway clone and runs `pnpm check`. Add `--integration` to also migrate the trial database and run
every generated API + E2E test (requires `.env.trial.local`; reset that Neon branch from `testing` first).
Last result: offline 12/12 steps; integration 15/15 steps, Playwright 93/93.

## Not supported in v1 (hand-write with `pnpm gen route` + the generated patterns)

Many-to-many, file uploads, multi-select, rich text, datetime with time zone, computed fields,
per-field permissions, shared/public resources, server-side sorting choices, bulk actions, custom
layouts. See `.claude/skills/build-feature/SKILL.md` for how to handle these.
