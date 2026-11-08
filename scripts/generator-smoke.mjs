#!/usr/bin/env node
// Proves the generator templates end to end without keeping generated code in the starter.
//   node scripts/generator-smoke.mjs                 offline: generate all examples with --verify in a clone
//   node scripts/generator-smoke.mjs --integration   + migrate the trial DB and run every API/E2E test
// Integration REQUIRES .env.trial.local (dedicated Neon branch; reset it from `testing` first).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const integration = process.argv.includes("--integration");
const keep = process.argv.includes("--keep");
// Order matters: parents before children, dashboards last.
const EXAMPLES = ["project", "task", "expense", "bookmark", "milestone", "overview"];
const ROUTE = "weeklyReport";

const sh = (cmd, args, cwd) => {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "", ms: Date.now() - started };
};
const steps = [];
function step(name, result) {
  steps.push({ name, ok: result.ok, seconds: +(result.ms / 1000).toFixed(1) });
  console.log(`${result.ok ? "✓" : "✗"} ${name} (${(result.ms / 1000).toFixed(1)}s)`);
  if (!result.ok) {
    console.log(result.out.split("\n").slice(-60).join("\n"));
    finish(1);
  }
  return result;
}

const dir = join(dirname(root), `${basename(root)}-trials`, `smoke-${Date.now()}`);
function finish(code) {
  console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps passed. Clone: ${dir}`);
  if (!keep && code === 0) rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

if (sh("git", ["status", "--porcelain", "--untracked-files=no"], root).stdout.trim()) {
  console.warn("⚠ Uncommitted changes are NOT included: the smoke test uses committed HEAD.");
}
mkdirSync(dirname(dir), { recursive: true });
step("clone HEAD", sh("git", ["clone", "--quiet", "--no-hardlinks", root, dir], root));

if (integration) {
  const trialPath = join(root, ".env.trial.local");
  if (!existsSync(trialPath)) {
    console.error("--integration needs .env.trial.local (dedicated Neon branch).");
    process.exit(1);
  }
  const trial = parse(readFileSync(trialPath, "utf8"));
  const host = (url) => (url ? new URL(url).hostname : "");
  const forbidden = new Set(
    [".env.local", ".env.test.local"].flatMap((f) => {
      const env = parse(readFileSync(join(root, f), "utf8"));
      return [host(env.DATABASE_URL), host(env.DATABASE_URL_UNPOOLED)];
    }),
  );
  if (forbidden.has(host(trial.DATABASE_URL)) || forbidden.has(host(trial.DATABASE_URL_UNPOOLED))) {
    console.error("Refusing: trial DB points at the dev or testing host.");
    process.exit(1);
  }
  for (const f of [".env.local", ".env.test.local"]) {
    const env = { ...parse(readFileSync(join(root, f), "utf8")), DATABASE_URL: trial.DATABASE_URL, DATABASE_URL_UNPOOLED: trial.DATABASE_URL_UNPOOLED };
    writeFileSync(join(dir, f), Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n");
  }
} else {
  // Offline: Prisma generate/validate and Next typegen need syntactically valid env only.
  for (const f of [".env.local", ".env.test.local"]) {
    if (existsSync(join(root, f))) writeFileSync(join(dir, f), readFileSync(join(root, f), "utf8"));
  }
}

step("pnpm install", sh("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], dir));
step("prisma generate", sh("pnpm", ["exec", "prisma", "generate"], dir));
mkdirSync(join(dir, "specs"), { recursive: true });
for (const name of EXAMPLES) {
  writeFileSync(join(dir, "specs", `${name}.json`), readFileSync(join(root, "generator/examples", `${name}.json`)));
  step(`gen ${name} --verify`, sh("pnpm", ["-s", "gen", `specs/${name}.json`, "--verify"], dir));
}
step(`gen route ${ROUTE} --verify`, sh("pnpm", ["-s", "gen", "route", ROUTE, "--verify"], dir));
step("idempotent re-run (all unchanged)", (() => {
  const r = sh("pnpm", ["-s", "gen", "specs/task.json", "--dry-run"], dir);
  return { ...r, ok: r.ok && !/\b(create|regenerate|conflict)\s{2,}/.test(r.out) };
})());
step("pnpm check", sh("pnpm", ["check"], dir));

if (integration) {
  step("migrate trial DB (deploy baseline)", sh("pnpm", ["exec", "prisma", "migrate", "deploy"], dir));
  step("create + apply smoke migration", sh("pnpm", ["exec", "prisma", "migrate", "dev", "--name", "smoke"], dir));
  const pw = sh("pnpm", ["exec", "playwright", "test", "--reporter=json"], dir);
  let stats = null;
  try {
    stats = JSON.parse(pw.stdout).stats;
  } catch {
    /* build failure */
  }
  console.log(`Playwright: ${stats ? `${stats.expected} passed, ${stats.unexpected} failed, ${stats.flaky} flaky` : "no report"}`);
  writeFileSync(join(dir, "smoke-playwright.json"), pw.stdout);
  step("playwright (all API + E2E)", { ...pw, ok: pw.ok && stats?.unexpected === 0 });
}
finish(0);
