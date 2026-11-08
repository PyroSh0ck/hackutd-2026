import { expect, test, type APIRequestContext } from "@playwright/test";
import type { z } from "zod";
import { registerTestUser } from "./auth";

/**
 * Registers the invariant API suite every owner-scoped resource must pass.
 * Spec-specific behavior (field rules, search semantics) belongs in the
 * resource's own spec file, not here.
 */
export type OwnedResourceSuite = {
  /** e.g. "/api/projects" */
  basePath: string;
  /** Valid create body; called per test so values can be unique. */
  validCreate: () => Record<string, unknown>;
  /** Valid partial update body. */
  validUpdate: () => Record<string, unknown>;
  /** Bodies that must be rejected with 400 VALIDATION_ERROR on create. */
  invalidCreates: Array<{ label: string; body: unknown; field?: string }>;
  itemSchema: z.ZodType<{ id: string }>;
  listSchema: z.ZodType<{ data: Array<{ id: string }>; meta: { total: number } }>;
  operations: ReadonlyArray<"create" | "list" | "detail" | "update" | "delete">;
  /**
   * Optional per-user setup (e.g. create a parent record this user owns). Runs once per request
   * context; returned fields are merged underneath every valid create body for that user.
   */
  prepare?: (request: APIRequestContext) => Promise<Record<string, unknown>>;
};

const prepared = new WeakMap<APIRequestContext, Promise<Record<string, unknown>>>();

function extras(request: APIRequestContext, suite: OwnedResourceSuite): Promise<Record<string, unknown>> {
  if (!suite.prepare) return Promise.resolve({});
  if (!prepared.has(request)) prepared.set(request, suite.prepare(request));
  return prepared.get(request)!;
}

async function create(request: APIRequestContext, suite: OwnedResourceSuite, body?: Record<string, unknown>) {
  const data = body ?? { ...(await extras(request, suite)), ...suite.validCreate() };
  const response = await request.post(suite.basePath, { data });
  expect(response.status(), await response.text()).toBe(201);
  return suite.itemSchema.parse((await response.json()).data);
}

async function listIds(request: APIRequestContext, suite: OwnedResourceSuite) {
  const response = await request.get(`${suite.basePath}?pageSize=50`);
  expect(response.status()).toBe(200);
  return suite.listSchema.parse(await response.json()).data.map((item) => item.id);
}

export function describeOwnedResource(suite: OwnedResourceSuite) {
  const has = (op: OwnedResourceSuite["operations"][number]) => suite.operations.includes(op);
  const itemPath = (id: string) => `${suite.basePath}/${encodeURIComponent(id)}`;

  test.describe(`${suite.basePath} invariants`, () => {
    test("anonymous requests are rejected with 401 on every route", async ({ request }) => {
      const calls: Array<Promise<{ status(): number; json(): Promise<{ error: { code: string } }> }>> = [];
      if (has("list")) calls.push(request.get(suite.basePath));
      if (has("create")) calls.push(request.post(suite.basePath, { data: suite.validCreate() }));
      if (has("detail")) calls.push(request.get(itemPath("anything")));
      if (has("update")) calls.push(request.patch(itemPath("anything"), { data: suite.validUpdate() }));
      if (has("delete")) calls.push(request.delete(itemPath("anything")));

      for (const response of await Promise.all(calls)) {
        expect(response.status()).toBe(401);
        expect((await response.json()).error.code).toBe("UNAUTHORIZED");
      }
    });

    test("create then list returns the new item", async ({ request }) => {
      await registerTestUser(request);
      const item = await create(request, suite);
      expect(await listIds(request, suite)).toContain(item.id);
    });

    test("responses carry a request id and no-store caching", async ({ request }) => {
      await registerTestUser(request);
      const response = await request.get(suite.basePath);
      expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers()["cache-control"]).toBe("no-store");
    });

    test("another user's items are never exposed or mutable", async ({ playwright, baseURL }) => {
      const owner = await playwright.request.newContext({ baseURL });
      const intruder = await playwright.request.newContext({ baseURL });
      try {
        await registerTestUser(owner);
        await registerTestUser(intruder);
        const item = await create(owner, suite);

        expect(await listIds(intruder, suite)).not.toContain(item.id);

        if (has("detail")) {
          const response = await intruder.get(itemPath(item.id));
          expect(response.status()).toBe(404);
          expect((await response.json()).error.code).toBe("NOT_FOUND");
        }
        if (has("update")) {
          const response = await intruder.patch(itemPath(item.id), { data: suite.validUpdate() });
          expect(response.status()).toBe(404);
        }
        if (has("delete")) {
          const response = await intruder.delete(itemPath(item.id));
          expect(response.status()).toBe(404);
        }

        // The owner's item is unchanged and still present.
        expect(await listIds(owner, suite)).toContain(item.id);
        if (has("detail")) {
          const ownerView = await owner.get(itemPath(item.id));
          expect(ownerView.status()).toBe(200);
          expect((await ownerView.json()).data).toEqual(item);
        }
      } finally {
        await owner.dispose();
        await intruder.dispose();
      }
    });

    test("clients cannot supply ownership or ids", async ({ request }) => {
      await registerTestUser(request);
      for (const injected of [{ ownerId: "someone-else" }, { owner: { connect: { id: "x" } } }, { id: "chosen-id" }]) {
        const response = await request.post(suite.basePath, { data: { ...(await extras(request, suite)), ...suite.validCreate(), ...injected } });
        expect(response.status(), JSON.stringify(injected)).toBe(400);
        expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
      }
      if (has("update")) {
        const item = await create(request, suite);
        const response = await request.patch(itemPath(item.id), { data: { ownerId: "someone-else" } });
        expect(response.status()).toBe(400);
      }
    });

    test("malformed JSON is rejected with INVALID_JSON", async ({ request }) => {
      await registerTestUser(request);
      // Raw bytes: the client must not re-serialize the invalid JSON as a JSON string.
      const raw = { headers: { "Content-Type": "application/json" }, data: Buffer.from('{"broken":', "utf8") };
      const response = await request.post(suite.basePath, raw);
      expect(response.status()).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_JSON");

      if (has("update")) {
        const item = await create(request, suite);
        const patch = await request.patch(itemPath(item.id), raw);
        expect(patch.status()).toBe(400);
        expect((await patch.json()).error.code).toBe("INVALID_JSON");
      }
    });

    test("invalid create bodies are rejected with field errors", async ({ request }) => {
      await registerTestUser(request);
      for (const { label, body, field } of suite.invalidCreates) {
        // Prepared fields fill in what the case doesn't mention, but never the field under test,
        // so "missing parent" style cases stay invalid.
        const extra = Object.fromEntries(Object.entries(await extras(request, suite)).filter(([key]) => key !== field));
        const data = body && typeof body === "object" && !Array.isArray(body) ? { ...extra, ...body } : body;
        const response = await request.post(suite.basePath, { data: data as object });
        expect(response.status(), label).toBe(400);
        const json = await response.json();
        expect(json.error.code, label).toBe("VALIDATION_ERROR");
        if (field) expect(json.error.fieldErrors?.[field]?.length, label).toBeGreaterThan(0);
      }
    });

    test("invalid list queries are rejected", async ({ request }) => {
      await registerTestUser(request);
      for (const query of ["page=0", "pageSize=7", "ownerId=x"]) {
        const response = await request.get(`${suite.basePath}?${query}`);
        expect(response.status(), query).toBe(400);
      }
    });

    if (has("detail") || has("update") || has("delete")) {
      test("unknown and malformed ids return 404", async ({ request }) => {
        await registerTestUser(request);
        for (const id of ["does-not-exist", "../etc", "x".repeat(200)]) {
          if (has("detail")) expect((await request.get(itemPath(id))).status(), id).toBe(404);
          if (has("update")) expect((await request.patch(itemPath(id), { data: suite.validUpdate() })).status(), id).toBe(404);
          if (has("delete")) expect((await request.delete(itemPath(id))).status(), id).toBe(404);
        }
      });
    }

    if (has("update")) {
      test("update changes only the supplied fields", async ({ request }) => {
        await registerTestUser(request);
        const item = await create(request, suite);
        const patch = suite.validUpdate();
        const response = await request.patch(itemPath(item.id), { data: patch });
        expect(response.status()).toBe(200);
        const updated = suite.itemSchema.parse((await response.json()).data) as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) expect(updated[key]).toEqual(value);
        expect(updated.id).toBe(item.id);

        const empty = await request.patch(itemPath(item.id), { data: {} });
        expect(empty.status()).toBe(400);
      });
    }

    if (has("delete")) {
      test("delete removes the item and is not repeatable", async ({ request }) => {
        await registerTestUser(request);
        const item = await create(request, suite);
        expect((await request.delete(itemPath(item.id))).status()).toBe(204);
        expect(await listIds(request, suite)).not.toContain(item.id);
        expect((await request.delete(itemPath(item.id))).status()).toBe(404);
      });
    }
  });
}
