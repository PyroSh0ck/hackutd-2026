#!/usr/bin/env node
// Stop hook: completion evidence.
// - If the working tree changed since the last recorded check, runs `pnpm check`
//   (lint + typecheck + unit/component tests, ~15s) and records the REAL exit code and
//   output tail in .claude/evidence/last-check.json.
// - On failure, blocks stopping once (decision: block) with the failure tail so Claude fixes it.
// - Loop guard: if this stop was already continued by a Stop hook (stop_hook_active), it
//   records evidence but never blocks again. Unchanged trees are never re-checked.
// - Integration tests (DB + browser) are NOT run here; they are run explicitly at milestones.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const evidenceDir = join(root, ".claude/evidence");
const evidencePath = join(evidenceDir, "last-check.json");

const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";

// Fingerprint: tracked diff vs HEAD + untracked files (path, size, mtime), excluding evidence itself.
function treeFingerprint() {
  const hash = createHash("sha256");
  hash.update(git("rev-parse", "HEAD"));
  hash.update(git("diff", "HEAD", "--binary", "--", ".", ":(exclude).claude/evidence"));
  for (const path of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
    if (path.startsWith(".claude/evidence/")) continue;
    try {
      const stat = statSync(join(root, path));
      hash.update(`${path}:${stat.size}:${stat.mtimeMs}\n`);
    } catch {
      /* deleted meanwhile */
    }
  }
  return hash.digest("hex");
}

// Discord notification runs after evidence is written (sequencing matters; parallel hooks would race).
function notify() {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  spawnSync("node", [join(root, ".claude/hooks/notify-discord.mjs")], { input: JSON.stringify(input), timeout: 6000 });
}
process.on("exit", notify);

const fingerprint = treeFingerprint();
const previous = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : null;

if (previous?.fingerprint === fingerprint) {
  // Nothing changed since the last check: do not re-run.
  if (previous.exitCode !== 0 && !input.stop_hook_active) {
    console.log(JSON.stringify({ systemMessage: `Last \`pnpm check\` on this exact tree failed (exit ${previous.exitCode}). See .claude/evidence/last-check.json.` }));
  }
  process.exit(0);
}

const started = Date.now();
const result = spawnSync("pnpm", ["check"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const tail = output.trim().split("\n").slice(-40).join("\n");
const evidence = {
  command: "pnpm check",
  exitCode: result.status,
  durationMs: Date.now() - started,
  finishedAt: new Date().toISOString(),
  head: git("rev-parse", "--short", "HEAD").trim(),
  fingerprint,
  outputTail: tail,
};
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (result.status === 0) {
  console.log(JSON.stringify({ systemMessage: `pnpm check passed (${(evidence.durationMs / 1000).toFixed(1)}s) — evidence: .claude/evidence/last-check.json` }));
  process.exit(0);
}

if (input.stop_hook_active) {
  // Already continued once because of a Stop hook: report, do not loop.
  console.log(JSON.stringify({ systemMessage: `pnpm check still failing (exit ${result.status}). Report this to the user; evidence in .claude/evidence/last-check.json.` }));
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `\`pnpm check\` failed (exit ${result.status}). Fix the failures, or if they are pre-existing/unrelated, say so explicitly in your final report. Output tail:\n${tail}`,
  }),
);
process.exit(0);
