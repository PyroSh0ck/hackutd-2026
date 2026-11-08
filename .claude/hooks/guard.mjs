#!/usr/bin/env node
// PreToolUse guard. Blocks (exit 2, reason on stderr) a small set of actions that are
// hard to undo or belong to someone else. This is a guardrail against mistakes, NOT a
// security boundary: Claude could still change files via other tools/commands, and the
// user can edit or remove this hook in .claude/settings.json.
import { existsSync, readFileSync } from "node:fs";
import { relative, sep } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const tool = input.tool_name;
const args = input.tool_input ?? {};

// One-off, user-approved exceptions: exact repo-relative paths, one per line, in the gitignored
// .claude/guard-allow.local file. Delete the file afterwards to restore protection.
const allowPath = `${root}/.claude/guard-allow.local`;
const allowed = new Set(existsSync(allowPath) ? readFileSync(allowPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : []);

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${reason}\n`);
  process.exit(2);
}

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit" || tool === "NotebookEdit") {
  const file = args.file_path ?? args.notebook_path;
  if (typeof file === "string") {
    const rel = relative(root, file).split(sep).join("/");
    if (!rel.startsWith("..") && !allowed.has(rel)) {
      if (rel.startsWith("visual-design/"))
        block("visual-design/ is owned by the designer. Describe the needed visual change to the user instead of editing it.");
      if (rel.startsWith("src/generated/")) block("src/generated/ is Prisma output. Change prisma/*.prisma and run `pnpm exec prisma generate`.");
      if (rel === "generator/manifest.json") block("generator/manifest.json is written only by `pnpm gen`.");
      if (/^prisma\/migrations\/[^/]+\/migration\.sql$/.test(rel))
        block("Applied migrations are immutable. Change the schema and create a new migration with `pnpm db:migrate:dev --name ...`.");
      if (/^\.env/.test(rel.split("/").pop() ?? "") && !rel.endsWith(".env.example")) block("Environment files hold secrets; ask the user to edit them.");
      if (rel === "tests/helpers/owned-resource.ts")
        block("The shared ownership/validation invariant suite is trusted. Ask the user before changing it; never weaken assertions to pass.");
    }
  }
}

if (tool === "Bash" && typeof args.command === "string") {
  const cmd = args.command;
  if (/\bprisma\s+migrate\s+reset\b/.test(cmd) || /\bdb\s+push\b.*--force-reset/.test(cmd))
    block("Database resets are not run by Claude. Ask the user, and name the exact database first.");
  if (/\bprisma\s+db\s+push\b/.test(cmd)) block("Use migrations (`pnpm db:migrate:dev`, `pnpm db:migrate:test`), not `prisma db push`.");
  if (/\bgit\s+push\b[^|;&]*(--force\b|-f\b|--force-with-lease)/.test(cmd)) block("Force pushes need explicit user approval.");
  if (/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/.test(cmd)) block("This discards work. Ask the user first.");
}

process.exit(0);
