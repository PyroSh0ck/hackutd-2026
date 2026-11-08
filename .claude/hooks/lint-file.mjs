#!/usr/bin/env node
// PostToolUse (Edit|Write): fast feedback on the single edited TS/TSX file.
// Runs ESLint on that file only (~1–2s). Never runs the full suite per edit.
// Errors are reported to Claude via exit 2 + stderr; the edit itself is not undone.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, sep } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const file = input.tool_input?.file_path;
if (typeof file !== "string" || !/\.(ts|tsx|mts)$/.test(file)) process.exit(0);

const rel = relative(root, file).split(sep).join("/");
if (rel.startsWith("..") || rel.startsWith("src/generated/") || rel.startsWith("node_modules/")) process.exit(0);

const result = spawnSync("pnpm", ["exec", "eslint", "--no-warn-ignored", rel], { cwd: root, encoding: "utf8" });
if (result.status === 0) process.exit(0);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
process.stderr.write(`ESLint reported problems in ${rel} (fix before finishing):\n${output}\n`);
process.exit(2);
