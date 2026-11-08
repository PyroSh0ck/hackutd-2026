// `pnpm gen route <name>`: scaffold for a custom authenticated endpoint the specs cannot express
// (workflows, cross-resource actions, integrations). Produces the house pattern with TODOs.
import { z } from "zod";
import { canonical, checkInsertions, classifyFiles, collectConflicts, readManifest, sha256, type Plan } from "./generate";
import { lit } from "./model";
import { RESERVED_RESOURCE_NAMES } from "./spec";

export const RouteNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{1,30}$/, { message: "Route name must be lowerCamelCase letters/digits (2–31 chars)." })
  .refine((value) => !RESERVED_RESOURCE_NAMES.has(value), { message: "Route name is reserved." });

const pascal = (s: string) => s[0].toUpperCase() + s.slice(1);
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function renderRouteFiles(name: string) {
  const N = pascal(name);
  const k = kebab(name);
  const head = `// Scaffolded by \`pnpm gen route ${name}\`. You own this file: replace every TODO.\n`;
  return [
    {
      path: `src/contracts/${k}.ts`,
      content: `${head}import { z } from "zod";

// TODO: describe the request body. Keep .strict() so unknown keys (e.g. ownerId) are rejected.
export const ${N}InputSchema = z
  .object({
    note: z.string().trim().min(1, "Note is required.").max(200),
  })
  .strict();

// TODO: describe the response payload.
export const ${N}ResultSchema = z.object({
  message: z.string(),
});

export const ${N}ResponseSchema = z.object({ data: ${N}ResultSchema });

export type ${N}Input = z.infer<typeof ${N}InputSchema>;
export type ${N}Result = z.infer<typeof ${N}ResultSchema>;
`,
    },
    {
      path: `src/server/services/${k}-service.ts`,
      content: `${head}import "server-only";

import type { ${N}Input, ${N}Result } from "@/contracts/${k}";
// import { prisma } from "@/server/db";
// import { NotFoundError, HttpError } from "@/server/http/errors";

// Rules: every Prisma query filters by ownerId. Records the user does not own are NotFoundError (404).
// Throw HttpError(400, "VALIDATION_ERROR", message, { fieldErrors }) for business-rule violations.

export async function read${N}(ownerId: string): Promise<${N}Result> {
  // TODO: read data scoped to ownerId.
  return { message: \`Ready for \${ownerId.length > 0 ? "you" : "nobody"}.\` };
}

export async function run${N}(ownerId: string, input: ${N}Input): Promise<${N}Result> {
  // TODO: implement the action, scoped to ownerId.
  return { message: \`Received: \${input.note}\` };
}
`,
    },
    {
      path: `src/app/api/${k}/route.ts`,
      content: `${head}import { ${N}InputSchema, ${N}ResponseSchema } from "@/contracts/${k}";
import { authRoute, parseInput, readJson } from "@/server/http/route";
import { read${N}, run${N} } from "@/server/services/${k}-service";

// authRoute handles: session (401), request id, logging, error envelopes, no-store.
export const GET = authRoute(${lit(`/api/${k}`)}, ${lit(`Unable to load ${k}.`)}, async ({ user }) => {
  const result = await read${N}(user.id);
  return { status: 200, body: ${N}ResponseSchema.parse({ data: result }) };
});

export const POST = authRoute(${lit(`/api/${k}`)}, ${lit(`Unable to complete ${k}.`)}, async ({ request, user }) => {
  const input = parseInput(${N}InputSchema, await readJson(request));
  const result = await run${N}(user.id, input);
  return { status: 200, body: ${N}ResponseSchema.parse({ data: result }) };
});
`,
    },
    {
      path: `src/features/${k}/api.ts`,
      content: `${head}import { ${N}ResponseSchema, type ${N}Input } from "@/contracts/${k}";
import { apiRequest } from "@/lib/api-client";

export async function get${N}() {
  return (await apiRequest(${lit(`/api/${k}`)}, ${N}ResponseSchema)).data;
}

export async function post${N}(input: ${N}Input) {
  return (await apiRequest(${lit(`/api/${k}`)}, ${N}ResponseSchema, { method: "POST", body: input })).data;
}
`,
    },
    {
      path: `tests/api/${k}.spec.ts`,
      content: `${head}import { expect, test } from "@playwright/test";
import { ${N}ResponseSchema } from "../../src/contracts/${k}";
import { registerTestUser } from "../helpers/auth";

const PATH = ${lit(`/api/${k}`)};

test("anonymous requests are rejected with 401", async ({ request }) => {
  expect((await request.get(PATH)).status()).toBe(401);
  expect((await request.post(PATH, { data: { note: "x" } })).status()).toBe(401);
});

test("malformed JSON and unknown keys are rejected", async ({ request }) => {
  await registerTestUser(request);
  const raw = await request.post(PATH, { headers: { "Content-Type": "application/json" }, data: Buffer.from('{"note":', "utf8") });
  expect(raw.status()).toBe(400);
  expect((await raw.json()).error.code).toBe("INVALID_JSON");
  const injected = await request.post(PATH, { data: { note: "x", ownerId: "someone-else" } });
  expect(injected.status()).toBe(400);
  expect((await injected.json()).error.code).toBe("VALIDATION_ERROR");
});

// TODO: replace with assertions for the real behavior, including another user's data never leaking.
test("happy path", async ({ request }) => {
  await registerTestUser(request);
  const response = await request.post(PATH, { data: { note: "hello" } });
  expect(response.status(), await response.text()).toBe(200);
  expect(${N}ResponseSchema.parse(await response.json()).data.message).toContain("hello");
});
`,
    },
  ];
}

export function planRoute(root: string, name: string, options: { force?: boolean } = {}): Plan {
  const manifest = readManifest(root);
  const conflicts: string[] = [];
  const files = classifyFiles(root, manifest.features[name], renderRouteFiles(name), options.force);
  const insertions = checkInsertions(root, []);
  collectConflicts(files, insertions, conflicts);
  if (manifest.features[name] && !Object.keys(manifest.features[name].files).some((path) => path.startsWith(`src/app/api/${kebab(name)}/`))) {
    conflicts.push(`'${name}' is already used by another generated feature.`);
  }
  return { key: name, specPath: `(route ${name})`, specHash: sha256(canonical({ route: name })), files, insertions, conflicts };
}
