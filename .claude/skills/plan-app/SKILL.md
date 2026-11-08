---
name: plan-app
description: Turn a hackathon brief or project planning document into a constrained implementation plan and feature specs for this starter. Use when the user provides a brief/idea/requirements doc, or asks "what should we build" / "plan this app".
when_to_use: At the start of a new app or a large batch of features, before writing code.
---

# Brief → plan → specs

Produce `docs/PLAN.md` and one `specs/<name>.json` per generated resource. Do not write feature code
in this step. Keep the plan short enough to read in two minutes.

## 1. Extract

From the brief, list: users/roles, the core records they manage, key screens, must-have vs nice-to-have,
and anything needing external services. Note ambiguities.

## 2. Classify every requirement

| Bucket | Meaning |
| --- | --- |
| **Generate** | Owner-scoped resources, `belongsTo` relations, and count/sum/avg dashboards (see `generator/README.md`, `generator/examples/`). |
| **Generate + customize** | Generated base plus a small hand-written addition (see the table in the `build-feature` skill). |
| **Custom route** | Workflows, cross-resource actions, integrations, computed views: `pnpm gen route <name>` scaffold, then implement. |
| **Out of scope / later** | Not needed for the demo, or needs money/credentials the user hasn't approved. |

Prefer fewer, richer resources over many thin ones. The demo needs a clear happy path, not every feature.

## 3. Write `docs/PLAN.md`

Sections: Goal (1–2 lines) · Resources (table: name, fields, relations, operations, bucket) · Dashboards · Custom routes
(ordered, each with acceptance check) · Build order · Open questions/assumptions · Out of scope.
Every item gets a concrete acceptance check (a test or a visible behavior).

## 4. Write specs and validate them

For each Generate item: write `specs/<name>.json` (start from the closest file in `generator/examples/`),
run `pnpm gen check specs/<name>.json` (check accepts parents/resources that are only planned in
`specs/`). `--dry-run` and generation need parents generated first, so run those in build order.
Fix issues before showing the plan.

## 5. Stop and confirm

Show the user the resources table, the open questions, and anything that would cost money. Only ask
questions whose answers change the plan; state reasonable defaults for the rest. After confirmation,
build in plan order with the `build-feature` skill.
