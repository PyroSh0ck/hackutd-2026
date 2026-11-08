// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- these tests mutate raw, untyped JSON specs on purpose */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPlan, applyRemove, planFeature, planRemove, readManifest, renderFiles } from "../../generator/generate";
import { resolve } from "../../generator/model";
import { validateSpec, type FeatureSpec } from "../../generator/spec";

const taskJson = JSON.parse(readFileSync("generator/examples/task.json", "utf8"));
function spec(mutate?: (s: Record<string, any>) => void): FeatureSpec {
  const raw = structuredClone(taskJson);
  mutate?.(raw);
  const result = validateSpec(raw);
  if (!result.ok) throw new Error(result.issues.join("\n"));
  return result.spec;
}

const SCHEMA = `model User {
  id String @id
  // generator:user-relations (feature generator inserts back-relations below this line)
}
`;
const NAV = `export const featureNavigation = [
  // generator:nav-items
];
`;

let root: string;

/** Every file under root with its content, for before/after comparisons. */
function snapshot(dir = root, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) Object.assign(out, snapshot(abs, rel));
    else out[rel] = readFileSync(abs, "utf8");
  }
  return out;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gen-test-"));
  mkdirSync(join(root, "prisma"), { recursive: true });
  mkdirSync(join(root, "src/config"), { recursive: true });
  writeFileSync(join(root, "prisma/schema.prisma"), SCHEMA);
  writeFileSync(join(root, "src/config/navigation.ts"), NAV);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("generator", () => {
  it("renders deterministic output", () => {
    const a = renderFiles(resolve(spec()));
    const b = renderFiles(resolve(spec()));
    expect(a).toEqual(b);
    expect(planFeature(root, spec(), "generator/examples/task.json").specHash).toBe(planFeature(root, spec(), "generator/examples/task.json").specHash);
  });

  it("planning (dry run) writes nothing", () => {
    const before = snapshot();
    const plan = planFeature(root, spec(), "generator/examples/task.json");
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.every((file) => file.status === "create")).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  it("writes files, insertions, and a manifest; re-planning is a no-op", () => {
    const plan = planFeature(root, spec(), "generator/examples/task.json");
    const result = applyPlan(root, plan);
    expect(result.ok).toBe(true);

    expect(readFileSync(join(root, "prisma/schema.prisma"), "utf8")).toContain("  tasks Task[]");
    expect(readFileSync(join(root, "src/config/navigation.ts"), "utf8")).toContain('href: "/tasks"');
    expect(Object.keys(readManifest(root).features.task.files)).toHaveLength(plan.files.length);

    const again = planFeature(root, spec(), "generator/examples/task.json");
    expect(again.conflicts).toEqual([]);
    expect(again.files.every((file) => file.status === "unchanged")).toBe(true);
    expect(again.insertions.every((ins) => ins.status === "present")).toBe(true);
  });

  it("refuses to overwrite a file it did not create", () => {
    mkdirSync(join(root, "src/contracts"), { recursive: true });
    writeFileSync(join(root, "src/contracts/task.ts"), "// user code\n");
    const plan = planFeature(root, spec(), "generator/examples/task.json");
    expect(plan.conflicts.join("\n")).toMatch(/src\/contracts\/task\.ts: exists and was not created by the generator/);
    expect(() => applyPlan(root, plan)).toThrow(/conflicts/);
    expect(readFileSync(join(root, "src/contracts/task.ts"), "utf8")).toBe("// user code\n");
  });

  it("regenerates unmodified files only with --force, and never edited ones", () => {
    applyPlan(root, planFeature(root, spec(), "generator/examples/task.json"));
    const changed = spec((s) => (s.fields[0].maxLength = 120));

    const withoutForce = planFeature(root, changed, "generator/examples/task.json");
    expect(withoutForce.conflicts.join("\n")).toMatch(/pass --force/);

    const forced = planFeature(root, changed, "generator/examples/task.json", { force: true });
    expect(forced.conflicts).toEqual([]);
    expect(applyPlan(root, forced).ok).toBe(true);
    expect(readFileSync(join(root, "src/contracts/task.ts"), "utf8")).toContain(".max(120,");

    writeFileSync(join(root, "src/contracts/task.ts"), "// hand edited\n");
    const edited = planFeature(root, spec(), "generator/examples/task.json", { force: true });
    expect(edited.conflicts.join("\n")).toMatch(/src\/contracts\/task\.ts: edited since generation/);
  });

  it("refuses when an insertion marker is missing", () => {
    writeFileSync(join(root, "src/config/navigation.ts"), "export const featureNavigation = [];\n");
    const plan = planFeature(root, spec(), "generator/examples/task.json");
    expect(plan.conflicts.join("\n")).toMatch(/navigation\.ts: expected exactly one/);
  });

  it("refuses when the Prisma model already exists elsewhere", () => {
    writeFileSync(join(root, "prisma/schema.prisma"), `${SCHEMA}\nmodel Task {\n  id String @id\n}\n`);
    expect(planFeature(root, spec(), "generator/examples/task.json").conflicts.join("\n")).toMatch(/Prisma model 'Task' already exists/);
  });

  it("rolls back every write when a write fails midway", () => {
    // A file where a directory must go makes a later write fail after earlier ones succeeded.
    mkdirSync(join(root, "src/features"), { recursive: true });
    writeFileSync(join(root, "src/features/tasks"), "blocker");
    const before = snapshot();

    const result = applyPlan(root, planFeature(root, spec(), "generator/examples/task.json"));
    expect(result.ok).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(existsSync(join(root, "src/contracts"))).toBe(false);
  });

  it("removes unmodified generated files and insertions, keeping edited files", () => {
    const original = snapshot();
    applyPlan(root, planFeature(root, spec(), "generator/examples/task.json"));
    writeFileSync(join(root, "tests/e2e/tasks.spec.ts"), "// edited\n");

    const plan = planRemove(root, "task")!;
    expect(plan.keep.map((k) => k.path)).toEqual(["tests/e2e/tasks.spec.ts"]);
    applyRemove(root, plan);

    const after = snapshot();
    expect(after["prisma/schema.prisma"]).toBe(original["prisma/schema.prisma"]);
    expect(after["src/config/navigation.ts"]).toBe(original["src/config/navigation.ts"]);
    expect(after["tests/e2e/tasks.spec.ts"]).toBe("// edited\n");
    expect(Object.keys(after).filter((path) => !path.startsWith("generator/") && !(path in original))).toEqual(["tests/e2e/tasks.spec.ts"]);
    expect(readManifest(root).features.task).toBeUndefined();
  });

  it("omits item routes and pages for a create/list-only resource", () => {
    const files = renderFiles(resolve(spec((s) => (s.operations = ["create", "list"])))).map((f) => f.path);
    expect(files).not.toContain("src/app/api/tasks/[id]/route.ts");
    expect(files).not.toContain("src/app/tasks/[id]/page.tsx");
    expect(files).not.toContain("src/features/tasks/components/task-detail.tsx");
  });

  it("emits user text only as escaped string literals", () => {
    const files = renderFiles(resolve(spec((s) => (s.fields[0].label = "Owner's title (main)"))));
    const form = files.find((f) => f.path.endsWith("task-form.tsx"))!.content;
    expect(form).toContain(`label={"Owner's title (main)"}`);
    const e2e = files.find((f) => f.path.endsWith("tasks.spec.ts") && f.path.startsWith("tests/e2e"))!.content;
    expect(e2e).toContain(String.raw`"^Owner's title \\(main\\)( \\*)?$"`);
  });
});

describe("dashboard resolution", () => {
  const dashboard = {
    version: 1,
    kind: "dashboard",
    name: "overview",
    label: "Overview",
    stats: [{ id: "flagged", label: "Flagged", resource: "task", aggregate: "count", where: { flagged: true } }],
  } as const;

  it("requires generated resources for generation but accepts planned specs for check", async () => {
    const { DashboardSpecSchema, resolveDashboard } = await import("../../generator/dashboard");
    const spec = DashboardSpecSchema.parse(dashboard);
    expect(resolveDashboard(root, spec).ok).toBe(false);

    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs/task.json"), JSON.stringify(taskJson));
    expect(resolveDashboard(root, spec, { allowPlanned: true }).ok).toBe(true);
    expect(resolveDashboard(root, spec).ok).toBe(false);
  });

  it("rejects filters on non-boolean/enum fields and sums of non-numeric fields", async () => {
    const { DashboardSpecSchema, resolveDashboard } = await import("../../generator/dashboard");
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs/task.json"), JSON.stringify(taskJson));
    const bad = DashboardSpecSchema.parse({
      ...dashboard,
      stats: [
        { id: "a", label: "A", resource: "task", aggregate: "count", where: { title: "x" } },
        { id: "b", label: "B", resource: "task", aggregate: "sum", field: "title" },
      ],
    });
    const result = resolveDashboard(root, bad, { allowPlanned: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join("\n")).toMatch(/only boolean and enum[\s\S]*must be an int or decimal/);
  });
});
