#!/usr/bin/env node
// Optional one-way Discord progress notifications (Notification + Stop events).
// No-op unless DISCORD_WEBHOOK_URL is set in the environment that launches Claude Code
// (e.g. `export DISCORD_WEBHOOK_URL=...` in your shell; never commit it).
// Runs async so it never slows Claude down. Sends no code, diffs, or file contents.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const url = process.env.DISCORD_WEBHOOK_URL;
if (!url || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) process.exit(0);

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const project = basename(root);
let content;

if (input.hook_event_name === "Notification") {
  content = `🔔 **${project}**: ${String(input.message ?? "Claude needs your attention").slice(0, 300)}`;
} else if (input.hook_event_name === "Stop") {
  const evidencePath = join(root, ".claude/evidence/last-check.json");
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : null;
  const status = evidence ? (evidence.exitCode === 0 ? "✅ pnpm check passed" : `❌ pnpm check failed (exit ${evidence.exitCode})`) : "no check recorded";
  const summary = String(input.last_assistant_message ?? "").replace(/\s+/g, " ").slice(0, 300);
  content = `🏁 **${project}** turn finished · ${status}${summary ? `\n> ${summary}` : ""}`;
} else process.exit(0);

try {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(5000),
  });
} catch {
  /* notifications are best-effort */
}
process.exit(0);
