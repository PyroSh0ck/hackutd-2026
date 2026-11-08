// Feature generator CLI.
//   pnpm gen <spec.json> [--dry-run] [--force] [--verify]   resource or dashboard spec (by "kind")
//   pnpm gen check <spec.json>                               validate only
//   pnpm gen preview <spec.json> [path-filter]               print generated files; writes nothing
//   pnpm gen preview route <name>                            print the custom-route scaffold
//   pnpm gen route <name> [--dry-run] [--force] [--verify]   scaffold a custom authenticated endpoint
//   pnpm gen remove <name> [--dry-run]
// Exit codes: 0 ok · 1 invalid spec/usage · 2 conflicts · 3 verification failed (rolled back) · 4 write failed (rolled back)
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DashboardSpecSchema, planDashboard, renderDashboardFiles, resolveDashboard } from "./dashboard";
import { applyPlan, applyRemove, childLines, planFeature, planRemove, readManifest, renderFiles, resolveWithParents, type Plan } from "./generate";
import { planRoute, renderRouteFiles, RouteNameSchema } from "./route";
import { validateSpec } from "./spec";
import { prismaModel } from "./templates/source";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const KNOWN_FLAGS = new Set(["--dry-run", "--force", "--verify"]);

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}
for (const flag of flags) if (!KNOWN_FLAGS.has(flag)) fail(1, `Unknown flag ${flag}`);

type Loaded =
  | { kind: "resource"; rel: string; plan: () => Plan; files: () => Array<{ path: string; content: string }>; extra: () => string }
  | { kind: "dashboard"; rel: string; plan: () => Plan; files: () => Array<{ path: string; content: string }>; extra: () => string };

function load(pathArg: string | undefined, options: { allowPlanned?: boolean } = {}): Loaded {
  if (!pathArg) fail(1, "Usage: pnpm gen <spec.json> [--dry-run] [--force] [--verify]");
  const abs = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || !rel.endsWith(".json")) fail(1, "Spec must be a .json file inside the repository.");
  if (!existsSync(abs)) fail(1, `Spec not found: ${rel}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    fail(1, `Spec is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const force = flags.has("--force");

  if (json && typeof json === "object" && (json as { kind?: unknown }).kind === "dashboard") {
    const parsed = DashboardSpecSchema.safeParse(json);
    if (!parsed.success) fail(1, `Invalid dashboard spec ${rel}:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}`);
    const resolved = resolveDashboard(root, parsed.data, options);
    if (!resolved.ok) fail(1, `Invalid dashboard spec ${rel}:\n${resolved.issues.map((i) => `  - ${i}`).join("\n")}`);
    const d = resolved.dashboard;
    return {
      kind: "dashboard",
      rel,
      plan: () => planDashboard(root, d, rel, { force }),
      files: () => renderDashboardFiles(d),
      extra: () => `Dashboard '${d.name}' (${d.label}) over: ${d.resources.map((r) => r.name).join(", ")}\nStats: ${d.stats.map((s) => `${s.id}=${s.aggregate}${s.field ? `(${s.field.name})` : ""}`).join(", ")}`,
    };
  }

  const result = validateSpec(json);
  if (!result.ok) fail(1, `Invalid spec ${rel}:\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}`);
  const spec = result.spec;
  const { resource: r } = resolveWithParents(root, spec);
  const children = childLines(readManifest(root), `prisma/models/${r.kebab}.prisma`);
  return {
    kind: "resource",
    rel,
    plan: () => planFeature(root, spec, rel, { force }),
    files: () => renderFiles(r, children),
    extra: () =>
      `Feature '${r.name}' (${r.pluralLabel})\nOperations: ${spec.operations.join(", ")} · Layout: ${spec.layout} · Fields: ${r.fields.map((f) => `${f.name}:${f.type}`).join(", ")}\n\nPrisma schema addition (prisma/models/${r.kebab}.prisma):\n${prismaModel(r, children)}`,
  };
}

function runPlan(plan: Plan, header: string, migrationHint?: string): never {
  console.log(`${header}\n`);
  for (const file of plan.files) console.log(`  ${file.status.padEnd(10)} ${file.path}${file.reason ? `  ← ${file.reason}` : ""}`);
  for (const ins of plan.insertions) console.log(`  ${ins.status.padEnd(10)} ${ins.path}: ${ins.line.trim()}${ins.reason ? `  ← ${ins.reason}` : ""}`);

  if (plan.conflicts.length) fail(2, `\n✗ ${plan.conflicts.length} conflict(s); nothing was written:\n${plan.conflicts.map((c) => `  - ${c}`).join("\n")}`);
  if (flags.has("--dry-run")) {
    console.log("\nDry run: nothing written. Use `pnpm gen preview` to read any file's content.");
    process.exit(0);
  }

  const result = applyPlan(root, plan, { verify: flags.has("--verify") });
  for (const step of result.verify) {
    console.log(`\n${step.ok ? "✓" : "✗"} ${step.name} (${(step.ms / 1000).toFixed(1)}s)`);
    if (!step.ok) console.log(step.output.split("\n").slice(-60).join("\n"));
  }
  if (!result.ok) fail(result.stage === "verify" ? 3 : 4, `\n✗ ${result.error}. All generated files and insertions were rolled back.`);

  console.log(`\n✓ Wrote ${result.written.length} file(s). Manifest: generator/manifest.json`);
  console.log(`\nNext steps (the generator never touches a database):${migrationHint ?? ""}
  - Run checks:  pnpm check   then the generated tests/api and tests/e2e specs with pnpm exec playwright test <files>
  - Implement custom behavior in the generated files (you own them now).`);
  process.exit(0);
}

const command = positional[0];

if (command === "check") {
  // check accepts resources that are only planned (specs/<name>.json), so a whole plan validates up front.
  const loaded = load(positional[1], { allowPlanned: true });
  console.log(`✓ ${loaded.rel} is a valid ${loaded.kind} spec.`);
  process.exit(0);
}

if (command === "preview" && positional[1] === "route") {
  const parsed = RouteNameSchema.safeParse(positional[2]);
  if (!parsed.success) fail(1, `Usage: pnpm gen preview route <lowerCamelName>`);
  for (const file of renderRouteFiles(parsed.data)) console.log(`\n===== ${file.path} =====\n${file.content}`);
  process.exit(0);
}

if (command === "preview") {
  const loaded = load(positional[1]);
  const filter = positional[2];
  const files = loaded.files().filter((file) => !filter || file.path.includes(filter));
  if (!files.length) fail(1, `No generated file matches '${filter}'. Files: \n${loaded.files().map((f) => `  ${f.path}`).join("\n")}`);
  for (const file of files) console.log(`\n===== ${file.path} =====\n${file.content}`);
  process.exit(0);
}

if (command === "route") {
  const parsed = RouteNameSchema.safeParse(positional[1]);
  if (!parsed.success) fail(1, `Usage: pnpm gen route <lowerCamelName>\n  - ${parsed.error.issues[0].message}`);
  runPlan(planRoute(root, parsed.data, { force: flags.has("--force") }), `Custom route '${parsed.data}'`);
}

if (command === "remove") {
  const name = positional[1];
  if (!name) fail(1, "Usage: pnpm gen remove <name> [--dry-run]");
  let plan;
  try {
    plan = planRemove(root, name);
  } catch (error) {
    fail(2, error instanceof Error ? error.message : String(error));
  }
  if (!plan) fail(1, `No generated feature named '${name}' in generator/manifest.json.`);
  console.log(`Remove '${name}':`);
  for (const path of plan.remove) console.log(`  delete  ${path}`);
  for (const { path, reason } of plan.keep) console.log(`  keep    ${path} (${reason})`);
  for (const ins of plan.insertions) console.log(`  unline  ${ins.path}: ${ins.line.trim()}`);
  if (flags.has("--dry-run")) {
    console.log("\nDry run: nothing changed.");
    process.exit(0);
  }
  applyRemove(root, plan);
  console.log("\n✓ Removed. Database tables/migrations are NOT touched; create a migration if a model should be dropped.");
  process.exit(0);
}

const loaded = load(command);
const plan = loaded.plan();
let hint: string | undefined;
if (loaded.kind === "resource" && plan.resource) {
  const migrationName = `add_${plan.resource.plural.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
  hint = `
  - Create + apply the migration on the dev database (.env.local):  pnpm db:migrate:dev --name ${migrationName}
  - Apply migrations to the testing branch (.env.test.local):       pnpm db:migrate:test`;
}
runPlan(plan, `${loaded.extra()}\nFrom ${loaded.rel}`, hint);
