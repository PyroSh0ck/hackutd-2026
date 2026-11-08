// Dashboard specs: per-user aggregate stats (count / sum / avg) over generated resources.
// Generates contract, service, GET route, client API, panel (DashboardLayout + StatCard), page, tests.
import { z } from "zod";
import { checkInsertions, classifyFiles, collectConflicts, canonical, loadGeneratedResource, loadPlannedResource, readManifest, sha256, NAV_MARKER, NAV_PATH, type Plan } from "./generate";
import { lit, sampleValue, type Field, type Resource } from "./model";
import { RESERVED_RESOURCE_NAMES } from "./spec";

const ident = z.string().regex(/^[a-z][a-zA-Z0-9]{0,29}$/, { message: "Use lowerCamelCase letters/digits." });
const text = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[\p{L}\p{N} .,'’()\-/&?!:%#+]+$/u, { message: "Use letters, numbers, spaces and basic punctuation only." });

export const DashboardSpecSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    kind: z.literal("dashboard"),
    name: ident.refine((value) => !RESERVED_RESOURCE_NAMES.has(value), { message: "Name is reserved." }),
    label: text(40),
    description: text(160).optional(),
    stats: z
      .array(
        z
          .object({
            id: ident,
            label: text(40),
            resource: ident,
            aggregate: z.enum(["count", "sum", "avg"]),
            field: ident.optional(),
            where: z.record(ident, z.union([z.boolean(), z.string()])).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    spec.stats.forEach((stat, i) => {
      if (ids.has(stat.id)) ctx.addIssue({ code: "custom", path: ["stats", i, "id"], message: "Stat ids must be unique." });
      ids.add(stat.id);
      if (stat.aggregate === "count" && stat.field) ctx.addIssue({ code: "custom", path: ["stats", i, "field"], message: "count takes no field." });
      if (stat.aggregate !== "count" && !stat.field) ctx.addIssue({ code: "custom", path: ["stats", i, "field"], message: `${stat.aggregate} needs a numeric field.` });
    });
  });

export type DashboardSpec = z.output<typeof DashboardSpecSchema>;

type Stat = Omit<DashboardSpec["stats"][number], "field"> & { r: Resource; field?: Field; whereFields: Array<{ f: Field; value: boolean | string }> };
export type Dashboard = { spec: DashboardSpec; name: string; Name: string; kebab: string; label: string; description: string; stats: Stat[]; resources: Resource[] };

const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Resolves referenced resources from the manifest. Returns issues for unknown resources/fields. */
export function resolveDashboard(
  root: string,
  spec: DashboardSpec,
  options: { allowPlanned?: boolean } = {},
): { ok: true; dashboard: Dashboard } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const resources = new Map<string, Resource>();
  const stats: Stat[] = [];

  spec.stats.forEach((stat, i) => {
    let r = resources.get(stat.resource);
    if (!r) {
      const loaded = options.allowPlanned ? loadPlannedResource(root, stat.resource) : loadGeneratedResource(root, stat.resource);
      if (!loaded) {
        issues.push(
          options.allowPlanned
            ? `stats.${i}.resource: '${stat.resource}' is neither generated nor planned (no specs/${stat.resource}.json).`
            : `stats.${i}.resource: '${stat.resource}' is not a generated resource (generate it first).`,
        );
        return;
      }
      r = loaded;
      resources.set(stat.resource, r);
    }
    const field = stat.field ? r.fields.find((f) => f.name === stat.field) : undefined;
    if (stat.field && !field) issues.push(`stats.${i}.field: '${stat.resource}' has no field '${stat.field}'.`);
    else if (field && field.type !== "int" && field.type !== "decimal") issues.push(`stats.${i}.field: '${stat.field}' must be an int or decimal field.`);

    const whereFields: Stat["whereFields"] = [];
    for (const [name, value] of Object.entries(stat.where ?? {})) {
      const f = r.fields.find((candidate) => candidate.name === name);
      if (!f) issues.push(`stats.${i}.where.${name}: unknown field.`);
      else if (f.type === "boolean" && typeof value !== "boolean") issues.push(`stats.${i}.where.${name}: must be true or false.`);
      else if (f.type === "enum" && !(typeof value === "string" && f.values.some((v) => v.value === value))) issues.push(`stats.${i}.where.${name}: must be one of ${f.values.map((v) => v.value).join(", ")}.`);
      else if (f.type !== "boolean" && f.type !== "enum") issues.push(`stats.${i}.where.${name}: only boolean and enum fields can be filtered.`);
      else whereFields.push({ f, value });
    }
    stats.push({ ...stat, r, field, whereFields });
  });

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    dashboard: {
      spec,
      name: spec.name,
      Name: pascal(spec.name),
      kebab: kebab(spec.name),
      label: spec.label,
      description: spec.description ?? "Your numbers at a glance.",
      stats,
      resources: [...resources.values()],
    },
  };
}

const header = (d: Dashboard) =>
  `// Generated by the feature generator from specs/${d.name}.json. You own this file:\n// edit freely. \`pnpm gen\` never overwrites edited files.\n`;

const whereObject = (s: Stat) => s.whereFields.map(({ f, value }) => `${f.name}: ${lit(value)}`).join(", ");

// ---------- templates ----------

function contract(d: Dashboard) {
  return `${header(d)}import { z } from "zod";

export const ${d.Name}StatsSchema = z.object({
${d.stats.map((s) => `  ${s.id}: z.number()${s.aggregate === "avg" ? ".nullable()" : ""},`).join("\n")}
});

export const ${d.Name}ResponseSchema = z.object({ data: ${d.Name}StatsSchema });

export type ${d.Name}Stats = z.infer<typeof ${d.Name}StatsSchema>;
`;
}

function service(d: Dashboard) {
  const lines = d.stats.map((s) => {
    const where = `{ ownerId${s.whereFields.length ? `, ${whereObject(s)}` : ""} }`;
    if (s.aggregate === "count") return `    prisma.${s.r.name}.count({ where: ${where} }),`;
    const key = s.aggregate === "sum" ? "_sum" : "_avg";
    return `    prisma.${s.r.name}.aggregate({ where: ${where}, ${key}: { ${s.field!.name}: true } }),`;
  });
  const assigns = d.stats.map((s, i) => {
    if (s.aggregate === "count") return `    ${s.id}: results[${i}],`;
    const key = s.aggregate === "sum" ? "_sum" : "_avg";
    const value = `results[${i}].${key}.${s.field!.name}`;
    return s.aggregate === "sum" ? `    ${s.id}: round(Number(${value} ?? 0)),` : `    ${s.id}: ${value} === null ? null : round(Number(${value})),`;
  });
  return `${header(d)}import "server-only";

import type { ${d.Name}Stats } from "@/contracts/${d.kebab}";
import { prisma } from "@/server/db";

const round = (value: number) => Math.round(value * 100) / 100;

/** Aggregates only rows owned by \`ownerId\`. */
export async function get${d.Name}(ownerId: string): Promise<${d.Name}Stats> {
  const results = await Promise.all([
${lines.join("\n")}
  ] as const);

  return {
${assigns.join("\n")}
  };
}
`;
}

function route(d: Dashboard) {
  return `${header(d)}import { ${d.Name}ResponseSchema } from "@/contracts/${d.kebab}";
import { authRoute } from "@/server/http/route";
import { get${d.Name} } from "@/server/services/${d.kebab}-service";

export const GET = authRoute(${lit(`/api/${d.kebab}`)}, ${lit(`Unable to load ${d.label.toLowerCase()}.`)}, async ({ user }) => {
  const stats = await get${d.Name}(user.id);
  return { status: 200, body: ${d.Name}ResponseSchema.parse({ data: stats }) };
});
`;
}

function clientApi(d: Dashboard) {
  return `${header(d)}import { ${d.Name}ResponseSchema } from "@/contracts/${d.kebab}";
import { apiRequest } from "@/lib/api-client";

export async function get${d.Name}() {
  return (await apiRequest(${lit(`/api/${d.kebab}`)}, ${d.Name}ResponseSchema)).data;
}
`;
}

function panel(d: Dashboard) {
  return `${header(d)}"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layouts/kit-layouts";
import { ErrorState } from "@/components/patterns/error-state";
import { StatCard } from "@/components/patterns/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ${d.Name}Stats } from "@/contracts/${d.kebab}";
import { errorMessage } from "@/lib/api-client";
import { get${d.Name} } from "@/features/${d.kebab}/api";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: ${d.Name}Stats };

const format = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US"));

export function ${d.Name}Panel() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    get${d.Name}()
      .then((stats) => active && setState({ status: "ready", stats }))
      .catch((error: unknown) => active && setState({ status: "error", message: errorMessage(error, ${lit(`Unable to load ${d.label.toLowerCase()}.`)}) }));
    return () => {
      active = false;
    };
  }, [attempt]);

  const stats =
    state.status === "ready" ? (
      <>
${d.stats.map((s) => `        <StatCard label={${lit(s.label)}} value={format(state.stats.${s.id})} />`).join("\n")}
      </>
    ) : state.status === "loading" ? (
      <div role="status" aria-label=${lit(`Loading ${d.label.toLowerCase()}`)}>
        <Skeleton kind="card" />
      </div>
    ) : null;

  return (
    <DashboardLayout title={${lit(d.label)}} description={${lit(d.description)}} stats={stats}>
      {state.status === "error" ? (
        <ErrorState
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
        />
      ) : null}
    </DashboardLayout>
  );
}
`;
}

function page(d: Dashboard) {
  return `${header(d)}import { AppShell } from "@/components/layouts/app-shell";
import { SessionGate } from "@/features/auth/session-gate";
import { ${d.Name}Panel } from "@/features/${d.kebab}/components/${d.kebab}-panel";

export default function ${d.Name}Page() {
  return (
    <AppShell>
      <SessionGate resourceLabel=${lit(d.label.toLowerCase())}>
        <${d.Name}Panel />
      </SessionGate>
    </AppShell>
  );
}
`;
}

// ---------- tests ----------

type Seed = { resource: Resource; body: Record<string, unknown> };

/** Records created per user in tests, chosen so every stat has matching and non-matching rows. */
function seeds(d: Dashboard): Seed[] {
  const out: Seed[] = [];
  for (const r of d.resources) {
    const base = (variant: 0 | 1) => Object.fromEntries(r.fields.filter((f) => f.type !== "belongsTo").map((f) => [f.name, sampleValue(f, variant)]));
    out.push({ resource: r, body: base(0) }, { resource: r, body: base(1) });
    for (const s of d.stats.filter((stat) => stat.r === r && stat.whereFields.length)) {
      out.push({ resource: r, body: { ...base(1), ...Object.fromEntries(s.whereFields.map(({ f, value }) => [f.name, value])) } });
    }
  }
  return out;
}

function expected(d: Dashboard, rows: Seed[]) {
  return Object.fromEntries(
    d.stats.map((s) => {
      const matching = rows.filter((row) => row.resource === s.r && s.whereFields.every(({ f, value }) => row.body[f.name] === value));
      if (s.aggregate === "count") return [s.id, matching.length];
      const values = matching.map((row) => row.body[s.field!.name]).filter((v): v is number => typeof v === "number");
      const sum = values.reduce((a, b) => a + b, 0);
      return [s.id, s.aggregate === "sum" ? Math.round(sum * 100) / 100 : values.length ? Math.round((sum / values.length) * 100) / 100 : null];
    }),
  );
}

function apiTest(d: Dashboard) {
  const rows = seeds(d);
  const zero = Object.fromEntries(d.stats.map((s) => [s.id, s.aggregate === "avg" ? null : 0]));
  // Required parents (belongsTo) are created once per seed call and attached to every child row.
  const parentRels = d.resources.flatMap((r) => r.relations.filter((f) => !f.createOptional));
  const parentSetup = [...new Map(parentRels.map((f) => [f.parent!.name, f.parent!])).values()]
    .map((p) => `  const ${p.name}Parent = await createOk(request, ${lit(`/api/${p.pluralKebab}`)}, { ...${JSON.stringify(p.sample)}, ${p.titleName}: unique(${lit(String(p.sample[p.titleName] ?? p.label))}, ${p.titleMaxLength}) });`)
    .join("\n");
  const create = rows
    .map(({ resource, body }) => {
      const parentFields = resource.relations.filter((f) => !f.createOptional).map((f) => `${f.name}: ${f.parent!.name}Parent.id, `).join("");
      return `  await createOk(request, ${lit(`/api/${resource.pluralKebab}`)}, { ...${JSON.stringify(body)}, ${parentFields}${resource.title.name}: unique(${lit(String(body[resource.title.name]))}, ${resource.title.type === "string" ? resource.title.maxLength : 100}) });`;
    })
    .join("\n");
  return `${header(d)}import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ${d.Name}ResponseSchema } from "../../src/contracts/${d.kebab}";
import { registerTestUser } from "../helpers/auth";

const PATH = ${lit(`/api/${d.kebab}`)};
const unique = (prefix: string, max: number) => \`\${prefix.slice(0, Math.max(0, max - 9))} \${randomUUID().slice(0, 8)}\`.trim().slice(0, max);

async function createOk(request: APIRequestContext, path: string, body: Record<string, unknown>) {
  const response = await request.post(path, { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as { id: string };
}

async function seed(request: APIRequestContext) {
${parentSetup ? `${parentSetup}\n` : ""}${create}
}

test("anonymous requests are rejected with 401", async ({ request }) => {
  const response = await request.get(PATH);
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe("UNAUTHORIZED");
});

test("a new user sees zero values", async ({ request }) => {
  await registerTestUser(request);
  const response = await request.get(PATH);
  expect(response.status()).toBe(200);
  expect(${d.Name}ResponseSchema.parse(await response.json()).data).toEqual(${JSON.stringify(zero)});
});

test("aggregates only the current user's records", async ({ playwright, baseURL }) => {
  const owner = await playwright.request.newContext({ baseURL });
  const other = await playwright.request.newContext({ baseURL });
  try {
    await registerTestUser(owner);
    await registerTestUser(other);
    await seed(owner);
    await seed(other);
    await seed(other);

    const stats = ${d.Name}ResponseSchema.parse(await (await owner.get(PATH)).json()).data;
    const expected: Record<string, number | null> = ${JSON.stringify(expected(d, rows))};
    for (const [key, value] of Object.entries(expected)) {
      if (value === null) expect(stats[key as keyof typeof stats], key).toBeNull();
      else expect(stats[key as keyof typeof stats], key).toBeCloseTo(value, 2);
    }
  } finally {
    await owner.dispose();
    await other.dispose();
  }
});
`;
}

function e2eTest(d: Dashboard) {
  return `${header(d)}import { expect, test } from "@playwright/test";
import { registerTestUser, signInThroughUi } from "../helpers/auth";

test(${lit(`${d.label} shows every stat for a signed-in user`)}, async ({ page, request }) => {
  await signInThroughUi(page, await registerTestUser(request));
  await page.goto(${lit(`/${d.kebab}`)});
${d.stats.map((s) => `  await expect(page.getByRole("heading", { name: ${lit(s.label)}, exact: true })).toBeVisible();`).join("\n")}
});

test(${lit(`${d.label} asks signed-out visitors to sign in`)}, async ({ page }) => {
  await page.goto(${lit(`/${d.kebab}`)});
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
`;
}

function panelTest(d: Dashboard) {
  const sample = Object.fromEntries(d.stats.map((s, i) => [s.id, i + 2]));
  return `${header(d)}import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { get${d.Name} } from "@/features/${d.kebab}/api";
import { ${d.Name}Panel } from "@/features/${d.kebab}/components/${d.kebab}-panel";

vi.mock("@/features/${d.kebab}/api", () => ({ get${d.Name}: vi.fn() }));
const mocked = vi.mocked(get${d.Name});

beforeEach(() => mocked.mockReset());

describe("${d.Name}Panel", () => {
  it("shows loading, then every stat", async () => {
    mocked.mockResolvedValue(${JSON.stringify(sample)});
    render(<${d.Name}Panel />);
    expect(screen.getByRole("status", { name: ${lit(`Loading ${d.label.toLowerCase()}`)} })).toBeInTheDocument();
${d.stats.map((s) => `    expect(await screen.findByRole("heading", { name: ${lit(s.label)} })).toBeVisible();\n    expect(screen.getByText(${lit(String(sample[s.id]))}, { exact: true })).toBeVisible();`).join("\n")}
  });

  it("shows an error with a working retry", async () => {
    const user = userEvent.setup();
    mocked.mockRejectedValueOnce(new Error("Stats unavailable"));
    mocked.mockResolvedValueOnce(${JSON.stringify(sample)});
    render(<${d.Name}Panel />);
    expect(await screen.findByText("Stats unavailable")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: ${lit(d.stats[0].label)} })).toBeVisible();
  });
});
`;
}

export function renderDashboardFiles(d: Dashboard) {
  return [
    { path: `src/contracts/${d.kebab}.ts`, content: contract(d) },
    { path: `src/server/services/${d.kebab}-service.ts`, content: service(d) },
    { path: `src/app/api/${d.kebab}/route.ts`, content: route(d) },
    { path: `src/features/${d.kebab}/api.ts`, content: clientApi(d) },
    { path: `src/features/${d.kebab}/components/${d.kebab}-panel.tsx`, content: panel(d) },
    { path: `src/app/${d.kebab}/page.tsx`, content: page(d) },
    { path: `tests/components/${d.kebab}-panel.test.tsx`, content: panelTest(d) },
    { path: `tests/api/${d.kebab}.spec.ts`, content: apiTest(d) },
    { path: `tests/e2e/${d.kebab}.spec.ts`, content: e2eTest(d) },
  ];
}

export function planDashboard(root: string, d: Dashboard, specPath: string, options: { force?: boolean } = {}): Plan {
  const manifest = readManifest(root);
  const conflicts: string[] = [];
  const files = classifyFiles(root, manifest.features[d.name], renderDashboardFiles(d), options.force);
  const insertions = checkInsertions(root, [
    { path: NAV_PATH, marker: NAV_MARKER, line: `  { id: ${lit(d.kebab)}, label: ${lit(d.label)}, href: ${lit(`/${d.kebab}`)} },` },
  ]);
  collectConflicts(files, insertions, conflicts);
  return { key: d.name, specPath, specHash: sha256(canonical(d.spec)), files, insertions, conflicts };
}
