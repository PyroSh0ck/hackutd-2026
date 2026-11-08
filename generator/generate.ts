// Plans, applies, verifies, and removes generated features.
// Guarantees: whole spec validated before any write; nothing written on conflict;
// failed writes/verification roll back every file and insertion; user-edited files are never overwritten.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parentRef, resolve as resolveResource, type ParentRef, type Resource } from "./model";
import { validateSpec, type FeatureSpec } from "./spec";
import * as src from "./templates/source";
import * as tst from "./templates/tests";

export const MANIFEST_PATH = "generator/manifest.json";
export const PRISMA_MARKER = "// generator:user-relations";
export const NAV_MARKER = "// generator:nav-items";
const NAV_PATH = "src/config/navigation.ts";
const SCHEMA_PATH = "prisma/schema.prisma";

export type FileStatus = "create" | "unchanged" | "regenerate" | "conflict";
export type PlannedFile = { path: string; content: string; status: FileStatus; reason?: string };
export type Insertion = { path: string; marker: string; line: string; status: "insert" | "present" | "conflict"; reason?: string };
export type Plan = {
  /** Manifest key (resource or dashboard name). */
  key: string;
  resource?: Resource;
  specPath: string;
  specHash: string;
  files: PlannedFile[];
  insertions: Insertion[];
  conflicts: string[];
};

export type ManifestEntry = { spec: string; specHash: string; files: Record<string, string>; insertions: Array<{ path: string; line: string }> };
export type Manifest = { version: 1; features: Record<string, ManifestEntry> };

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Deterministic JSON (sorted keys) for hashing and the manifest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function readManifest(root: string): Manifest {
  const path = join(root, MANIFEST_PATH);
  if (!existsSync(path)) return { version: 1, features: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function serializeManifest(manifest: Manifest) {
  const sorted: Manifest = { version: 1, features: {} };
  for (const name of Object.keys(manifest.features).sort()) {
    const entry = manifest.features[name];
    sorted.features[name] = {
      spec: entry.spec,
      specHash: entry.specHash,
      files: Object.fromEntries(Object.entries(entry.files).sort(([a], [b]) => a.localeCompare(b))),
      insertions: entry.insertions,
    };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** All generated files for a resource, in a fixed order. */
export function renderFiles(r: Resource, children: string[] = []): Array<{ path: string; content: string }> {
  const files = [
    { path: `src/contracts/${r.kebab}.ts`, content: src.contract(r) },
    { path: `src/server/services/${r.kebab}-service.ts`, content: src.service(r) },
    { path: `src/app/api/${r.pluralKebab}/route.ts`, content: src.collectionRoute(r) },
    r.hasItemRoute && { path: `src/app/api/${r.pluralKebab}/[id]/route.ts`, content: src.itemRoute(r) },
    { path: `src/features/${r.pluralKebab}/api.ts`, content: src.clientApi(r) },
    { path: `src/features/${r.pluralKebab}/components/${r.kebab}-form.tsx`, content: src.form(r) },
    { path: `src/features/${r.pluralKebab}/components/${r.kebab}-list.tsx`, content: src.list(r) },
    { path: `src/features/${r.pluralKebab}/components/${r.pluralKebab}-panel.tsx`, content: src.panel(r) },
    r.ops.detail && { path: `src/features/${r.pluralKebab}/components/${r.kebab}-detail.tsx`, content: src.detail(r) },
    { path: `src/app/${r.pluralKebab}/page.tsx`, content: src.listPage(r) },
    r.ops.detail && { path: `src/app/${r.pluralKebab}/[id]/page.tsx`, content: src.detailPage(r) },
    { path: `prisma/models/${r.kebab}.prisma`, content: src.prismaModel(r, children) },
    { path: `tests/unit/${r.kebab}-contract.test.ts`, content: tst.contractTest(r) },
    { path: `tests/components/${r.pluralKebab}-panel.test.tsx`, content: tst.panelTest(r) },
    { path: `tests/api/${r.pluralKebab}.spec.ts`, content: tst.apiTest(r) },
    { path: `tests/e2e/${r.pluralKebab}.spec.ts`, content: tst.e2eTest(r) },
  ];
  return files.filter((file): file is { path: string; content: string } => Boolean(file));
}

/** Prisma model names declared anywhere under prisma/ (excluding a given file). */
function existingModels(root: string, exclude: string): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "migrations") walk(rel);
      else if (entry.name.endsWith(".prisma") && rel !== exclude) {
        for (const match of readFileSync(join(root, rel), "utf8").matchAll(/^\s*model\s+(\w+)\s*\{/gm)) names.add(match[1]);
      }
    }
  };
  walk("prisma");
  return names;
}

/** Loads and resolves a previously generated resource from its recorded spec. */
export function loadGeneratedResource(root: string, name: string): Resource | null {
  const entry = readManifest(root).features[name];
  if (!entry || !existsSync(join(root, entry.spec))) return null;
  const parsed = validateSpec(JSON.parse(readFileSync(join(root, entry.spec), "utf8")));
  if (!parsed.ok || parsed.spec.name !== name) return null;
  return resolveWithParents(root, parsed.spec).resource;
}

/**
 * For `pnpm gen check` only: a resource that is generated, or else planned as specs/<name>.json.
 * Generation itself always requires the generated resource (its files must exist).
 */
export function loadPlannedResource(root: string, name: string): Resource | null {
  const generated = loadGeneratedResource(root, name);
  if (generated) return generated;
  const path = join(root, "specs", `${name}.json`);
  if (!existsSync(path)) return null;
  const parsed = validateSpec(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok || parsed.spec.name !== name) return null;
  return resolveResource(parsed.spec);
}

/** Resolves a spec with its belongsTo parents taken from the manifest. */
export function resolveWithParents(root: string, spec: FeatureSpec): { resource: Resource; missing: string[] } {
  const parents: Record<string, ParentRef> = {};
  const missing: string[] = [];
  for (const field of spec.fields) {
    if (field.type !== "belongsTo") continue;
    const parent = loadGeneratedResource(root, field.resource);
    if (parent) parents[field.resource] = parentRef(parent);
    else missing.push(field.resource);
  }
  return { resource: resolveResource(spec, parents), missing };
}

export function planFeature(root: string, spec: FeatureSpec, specPath: string, options: { force?: boolean } = {}): Plan {
  const { resource: r, missing } = resolveWithParents(root, spec);
  const manifest = readManifest(root);
  const entry = manifest.features[r.name];
  const conflicts: string[] = missing.map((name) => `belongsTo parent '${name}' has not been generated yet; generate it first.`);

  // Another generated feature must not already own these names.
  for (const [name, other] of Object.entries(manifest.features)) {
    if (name !== r.name && Object.keys(other.files).some((path) => path.includes(`/${r.pluralKebab}/`) || path.endsWith(`/${r.kebab}.ts`))) {
      conflicts.push(`Feature '${name}' already generated files for '${r.plural}'.`);
    }
  }

  const modelFile = `prisma/models/${r.kebab}.prisma`;
  if (existingModels(root, modelFile).has(r.Name)) conflicts.push(`Prisma model '${r.Name}' already exists outside ${modelFile}.`);

  const files = classifyFiles(root, entry, renderFiles(r, childLines(manifest, modelFile)), options.force);
  const insertions = checkInsertions(root, [
    { path: SCHEMA_PATH, marker: PRISMA_MARKER, line: src.userRelationLine(r) },
    { path: NAV_PATH, marker: NAV_MARKER, line: src.navLine(r) },
    ...r.relations
      .filter(() => missing.length === 0)
      .map((f) => ({ path: `prisma/models/${f.parent!.kebab}.prisma`, marker: src.RELATIONS_MARKER, line: src.parentRelationLine(r) })),
  ]);
  collectConflicts(files, insertions, conflicts);

  return { key: r.name, resource: r, specPath, specHash: sha256(canonical(spec)), files, insertions, conflicts };
}


/** Decides create/unchanged/regenerate/conflict for each rendered file. */
export function classifyFiles(
  root: string,
  entry: ManifestEntry | undefined,
  rendered: Array<{ path: string; content: string }>,
  force = false,
): PlannedFile[] {
  return rendered.map(({ path, content }) => {
    const abs = join(root, path);
    if (!existsSync(abs)) return { path, content, status: "create" };
    const current = readFileSync(abs, "utf8");
    if (current === content) return { path, content, status: "unchanged" };
    const recorded = entry?.files[path];
    if (recorded && recorded === sha256(current)) {
      return force
        ? { path, content, status: "regenerate" }
        : { path, content, status: "conflict", reason: "previously generated and unmodified; pass --force to regenerate" };
    }
    return {
      path,
      content,
      status: "conflict",
      reason: recorded ? "edited since generation; refusing to overwrite" : "exists and was not created by the generator",
    };
  });
}

/** Checks that each marker exists exactly once and whether the line is already present. */
export function checkInsertions(root: string, wanted: Array<{ path: string; marker: string; line: string }>): Insertion[] {
  return wanted.map((ins) => {
    const abs = join(root, ins.path);
    if (!existsSync(abs)) return { ...ins, status: "conflict" as const, reason: "file missing" };
    const text = readFileSync(abs, "utf8");
    const markerCount = text.split(ins.marker).length - 1;
    if (markerCount !== 1) return { ...ins, status: "conflict" as const, reason: `expected exactly one '${ins.marker}' marker, found ${markerCount}` };
    if (text.split("\n").some((line) => line.trim() === ins.line.trim())) return { ...ins, status: "present" as const };
    return { ...ins, status: "insert" as const };
  });
}

export function collectConflicts(files: PlannedFile[], insertions: Insertion[], conflicts: string[]) {
  for (const file of files) if (file.status === "conflict") conflicts.push(`${file.path}: ${file.reason}`);
  for (const ins of insertions) if (ins.status === "conflict") conflicts.push(`${ins.path}: ${ins.reason}`);
}

export { canonical, NAV_PATH };

// ---------- transactional writes ----------

class Transaction {
  private originals = new Map<string, string | null>();
  private createdDirs: string[] = [];
  constructor(private root: string) {}

  write(path: string, content: string) {
    const abs = join(this.root, path);
    if (!this.originals.has(path)) this.originals.set(path, existsSync(abs) ? readFileSync(abs, "utf8") : null);
    this.mkdirs(dirname(abs));
    writeFileSync(abs, content);
  }

  remove(path: string) {
    const abs = join(this.root, path);
    if (!existsSync(abs)) return;
    if (!this.originals.has(path)) this.originals.set(path, readFileSync(abs, "utf8"));
    rmSync(abs);
  }

  private mkdirs(dir: string) {
    const missing: string[] = [];
    let current = dir;
    while (!existsSync(current)) {
      missing.unshift(current);
      current = dirname(current);
    }
    for (const path of missing) {
      mkdirSync(path);
      this.createdDirs.push(path);
    }
  }

  /** Best-effort: restores every entry it can and returns paths it could not restore. */
  rollback(): string[] {
    const failed: string[] = [];
    for (const [path, original] of this.originals) {
      const abs = join(this.root, path);
      try {
        if (original === null) {
          if (existsSync(abs)) rmSync(abs, { force: true });
        } else {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, original);
        }
      } catch {
        // A write that never happened (e.g. parent is a file) has nothing to undo.
        if (original !== null || safeExists(abs)) failed.push(path);
      }
    }
    for (const dir of [...this.createdDirs].reverse()) {
      try {
        rmdirSync(dir);
      } catch {
        /* not empty: leave it */
      }
    }
    return failed;
  }
}

function safeExists(path: string) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** Back-relation lines other features inserted into `modelFile`, in manifest order. */
export function childLines(manifest: Manifest, modelFile: string): string[] {
  return Object.values(manifest.features).flatMap((entry) => entry.insertions.filter((ins) => ins.path === modelFile).map((ins) => ins.line));
}

/** Files edited by insertions may belong to another generated feature: keep its recorded hash current. */
function rehashInsertedFiles(root: string, manifest: Manifest, paths: string[]) {
  for (const path of new Set(paths)) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    const hash = sha256(readFileSync(abs, "utf8"));
    for (const entry of Object.values(manifest.features)) if (path in entry.files) entry.files[path] = hash;
  }
}

function insertAfterMarker(text: string, marker: string, line: string) {
  return text
    .split("\n")
    .flatMap((current) => (current.includes(marker) ? [current, line] : [current]))
    .join("\n");
}

export type VerifyStep = { name: string; command: string[]; ok: boolean; output: string; ms: number };

export type ApplyResult =
  | { ok: true; written: string[]; verify: VerifyStep[] }
  | { ok: false; stage: "write" | "verify"; error: string; verify: VerifyStep[] };

export function applyPlan(root: string, plan: Plan, options: { verify?: boolean } = {}): ApplyResult {
  if (plan.conflicts.length) throw new Error("applyPlan called with conflicts");
  const tx = new Transaction(root);
  const written: string[] = [];
  const manifest = readManifest(root);

  try {
    for (const file of plan.files) {
      if (file.status === "create" || file.status === "regenerate") {
        tx.write(file.path, file.content);
        written.push(file.path);
      }
    }
    for (const ins of plan.insertions) {
      if (ins.status !== "insert") continue;
      const text = readFileSync(join(root, ins.path), "utf8");
      tx.write(ins.path, insertAfterMarker(text, ins.marker, ins.line));
      written.push(ins.path);
    }
    rehashInsertedFiles(root, manifest, plan.insertions.filter((ins) => ins.status === "insert").map((ins) => ins.path));
    manifest.features[plan.key] = {
      spec: plan.specPath,
      specHash: plan.specHash,
      files: Object.fromEntries(plan.files.map((file) => [file.path, sha256(file.content)])),
      insertions: plan.insertions.map((ins) => ({ path: ins.path, line: ins.line })),
    };
    tx.write(MANIFEST_PATH, serializeManifest(manifest));
  } catch (error) {
    const unrestored = tx.rollback();
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stage: "write",
      error: unrestored.length ? `${message} (could not restore: ${unrestored.join(", ")})` : message,
      verify: [],
    };
  }

  if (!options.verify) return { ok: true, written, verify: [] };

  const generated = plan.files.map((file) => file.path);
  const steps = verifyCommands(generated);
  const results: VerifyStep[] = [];
  for (const step of steps) {
    const result = run(root, step.name, step.command);
    results.push(result);
    if (!result.ok) {
      tx.rollback();
      run(root, "restore prisma client", ["pnpm", "exec", "prisma", "generate"]);
      return { ok: false, stage: "verify", error: `${step.name} failed`, verify: results };
    }
  }
  return { ok: true, written, verify: results };
}

export function verifyCommands(generated: string[]) {
  const lintable = generated.filter((path) => /\.(ts|tsx)$/.test(path));
  const vitestFiles = generated.filter((path) => /^tests\/(unit|components)\//.test(path));
  return [
    { name: "prisma validate", command: ["pnpm", "exec", "prisma", "validate"] },
    { name: "prisma generate", command: ["pnpm", "exec", "prisma", "generate"] },
    { name: "typecheck", command: ["pnpm", "typecheck"] },
    { name: "lint generated files", command: ["pnpm", "exec", "eslint", "--max-warnings=0", ...lintable] },
    { name: "generated unit/component tests", command: ["pnpm", "exec", "vitest", "run", ...vitestFiles] },
  ];
}

function run(root: string, name: string, command: string[]): VerifyStep {
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, encoding: "utf8", env: process.env });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { name, command, ok: result.status === 0, output, ms: Date.now() - started };
}

// ---------- removal ----------

export type RemovePlan = { name: string; remove: string[]; keep: Array<{ path: string; reason: string }>; insertions: Array<{ path: string; line: string }> };

export function planRemove(root: string, name: string): RemovePlan | null {
  const manifest = readManifest(root);
  const entry = manifest.features[name];
  if (!entry) return null;
  const ownModel = Object.keys(entry.files).find((path) => path.startsWith("prisma/models/"));
  const dependents = Object.entries(manifest.features).filter(
    ([other, e]) => other !== name && ownModel && e.insertions.some((ins) => ins.path === ownModel),
  );
  if (dependents.length) {
    throw new Error(`Cannot remove '${name}': ${dependents.map(([other]) => `'${other}'`).join(", ")} belong(s) to it. Remove those first.`);
  }
  const remove: string[] = [];
  const keep: RemovePlan["keep"] = [];
  for (const [path, hash] of Object.entries(entry.files)) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    if (sha256(readFileSync(abs, "utf8")) === hash) remove.push(path);
    else keep.push({ path, reason: "edited since generation" });
  }
  return { name, remove, keep, insertions: entry.insertions };
}

export function applyRemove(root: string, plan: RemovePlan) {
  const tx = new Transaction(root);
  try {
    for (const path of plan.remove) tx.remove(path);
    for (const ins of plan.insertions) {
      const abs = join(root, ins.path);
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, "utf8");
      const next = text
        .split("\n")
        .filter((line) => line.trim() !== ins.line.trim())
        .join("\n");
      if (next !== text) tx.write(ins.path, next);
    }
    const manifest = readManifest(root);
    delete manifest.features[plan.name];
    rehashInsertedFiles(root, manifest, plan.insertions.map((ins) => ins.path));
    tx.write(MANIFEST_PATH, serializeManifest(manifest));
    // Clean up now-empty generated directories.
    for (const path of plan.remove) {
      let dir = dirname(join(root, path));
      while (relative(root, dir) && !["src", "tests", "prisma", "src/app", "src/features"].includes(relative(root, dir))) {
        try {
          rmdirSync(dir);
        } catch {
          break;
        }
        dir = dirname(dir);
      }
    }
  } catch (error) {
    tx.rollback();
    throw error;
  }
}
