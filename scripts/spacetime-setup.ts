/**
 * Creates a restricted SpacetimeDB worker identity for the Next.js backend and authorizes it in the
 * SCAMPER module (only the module admin, i.e. the publisher, can do that). Writes the worker credentials
 * to .spacetime/worker.json (gitignored, mode 600). The token is never printed.
 *
 *   SPACETIME_URL (default http://127.0.0.1:3300)   SPACETIME_DATABASE (default scamper-training)
 *   SPACETIME_SERVER: CLI server nickname used to call authorize_worker as admin (default stdb-local)
 *   SPACETIME_WORKER_FILE: credentials file to write (default .spacetime/worker.json), e.g. .spacetime/maincloud.json
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const url = process.env.SPACETIME_URL ?? "http://127.0.0.1:3300";
const database = process.env.SPACETIME_DATABASE ?? "scamper-training";
const server = process.env.SPACETIME_SERVER ?? "stdb-local";
const file = process.env.SPACETIME_WORKER_FILE ?? join(".spacetime", "worker.json");
const cli = process.env.SPACETIME_CLI ?? join(homedir(), ".local", "bin", "spacetime");

async function main() {
  const res = await fetch(`${url}/v1/identity`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not create a worker identity at ${url} (${res.status}). Is the server running?`);
  const { identity, token } = (await res.json()) as { identity: string; token: string };
  execFileSync(cli, ["call", "--server", server, database, "authorize_worker", JSON.stringify({ __identity__: `0x${identity}` })], { stdio: ["ignore", "ignore", "inherit"] });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ url, database, token, identity }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Authorized worker ${identity.slice(0, 12)}… for ${database} at ${url}. Credentials: ${file}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
