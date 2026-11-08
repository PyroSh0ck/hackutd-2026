// Test-file templates. Shared invariants come from tests/helpers/owned-resource.ts;
// everything here is derived from the spec's own fields so assertions stay specific.
import { formKind, invalidSamples, lit, sampleValue, type Field, type Resource } from "../model";
import { header } from "./source";

const js = (value: unknown) => (value === undefined ? "OMIT" : JSON.stringify(value));

/** Full valid create input (variant 0). */
function sampleObject(r: Resource, variant: 0 | 1 = 0) {
  return Object.fromEntries(r.fields.map((f) => [f.name, sampleValue(f, variant)]));
}

/** Only fields create cannot omit. */
function minimalObject(r: Resource) {
  return Object.fromEntries(r.fields.filter((f) => !f.createOptional).map((f) => [f.name, sampleValue(f)]));
}

/** Expected DTO value when a field is omitted on create. */
function omittedValue(f: Field): unknown {
  if (f.type === "boolean") return f.default;
  if ("default" in f && f.default !== undefined) return f.default;
  return null;
}

// ---------- unit: contract ----------

export function contractTest(r: Resource): string {
  const invalid = r.fields.flatMap((f) => invalidSamples(f).map(([label, value]) => `    [${lit(label)}, ${lit(f.name)}, ${js(value)}],`));
  const nullable = r.fields.filter((f) => f.nullable);

  return `${header(r)}import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Create${r.Name}Schema${r.ops.update ? `, Update${r.Name}Schema` : ""} } from "@/contracts/${r.kebab}";

const OMIT = Symbol("omit");
const valid = ${JSON.stringify(sampleObject(r))};
const minimal = ${JSON.stringify(minimalObject(r))};

function withField(field: string, value: unknown) {
  const input: Record<string, unknown> = { ...valid };
  if (value === OMIT) delete input[field];
  else input[field] = value;
  return input;
}

describe("Create${r.Name}Schema", () => {
  it("accepts a complete valid input", () => {
    expect(Create${r.Name}Schema.safeParse(valid).success).toBe(true);
  });

  it("accepts only the required fields", () => {
    expect(Create${r.Name}Schema.safeParse(minimal).success).toBe(true);
  });

  it.each(["ownerId", "id", "owner", "createdAt", "unexpected"])("rejects the unknown key %s", (key) => {
    expect(Create${r.Name}Schema.safeParse({ ...valid, [key]: "x" }).success).toBe(false);
  });

  it.each([
${invalid.join("\n")}
  ] as const)("rejects %s", (_label, field, value) => {
    const result = Create${r.Name}Schema.safeParse(withField(field, value));
    expect(result.success).toBe(false);
    if (!result.success) expect(z.flattenError(result.error).fieldErrors).toHaveProperty(field);
  });
${
  nullable.length
    ? `
  it.each([${nullable.map((f) => lit(f.name)).join(", ")}])("treats blank or null %s as null", (field) => {
    for (const blank of ["", "   ", null]) {
      const result = Create${r.Name}Schema.safeParse(withField(field, blank));
      expect(result.success, String(blank)).toBe(true);
      if (result.success) expect((result.data as Record<string, unknown>)[field]).toBeNull();
    }
  });
`
    : ""
}});
${
  r.ops.update
    ? `
describe("Update${r.Name}Schema", () => {
  it("accepts a single-field update", () => {
    expect(Update${r.Name}Schema.safeParse({ ${r.title.name}: ${lit(String(sampleValue(r.title, 1)))} }).success).toBe(true);
  });

  it.each([{}, { ownerId: "x" }, { id: "x" }, { ${r.title.name}: "" }, { ${r.title.name}: null }])("rejects %j", (input) => {
    expect(Update${r.Name}Schema.safeParse(input).success).toBe(false);
  });
});
`
    : ""
}`;
}

// ---------- component: panel states + form ----------

function fillComponent(f: Field, value: unknown): string {
  const target = `screen.getByLabelText(new RegExp(${lit(f.labelPattern)}))`;
  switch (formKind(f)) {
    case "select":
      return `    await user.selectOptions(${target}, ${lit(String(value))});`;
    case "checkbox":
      return f.type === "boolean" && value !== f.default ? `    await user.click(${target});` : "";
    case "reference":
      return `    await screen.findByRole("option", { name: ${lit(`${f.parent!.label} one`)} });\n    await user.selectOptions(${target}, ${lit(String(value))});`;
    default:
      return `    fireEvent.change(${target}, { target: { value: ${lit(String(value))} } });`;
  }
}

export function panelTest(r: Resource): string {
  const sample = sampleObject(r);
  const api = ["list", "create", ...(r.ops.detail ? ["get"] : []), ...(r.ops.update ? ["update"] : []), ...(r.ops.delete ? ["delete"] : [])];
  const fnName = (op: string) => (op === "list" ? `list${r.Plural}` : `${op}${r.Name}`);
  const relationDto = r.relations.map((f) => `, ${f.relation}: { id: ${lit(String(sampleValue(f)))}, label: ${lit(`${f.parent!.label} one`)} }`).join("");
  const parentMocks = r.relations
    .map(
      (f) =>
        `vi.mock("@/features/${f.parent!.pluralKebab}/api", () => ({\n  list${f.parent!.Plural}: vi.fn(async () => ({ data: [{ id: ${lit(String(sampleValue(f)))}, ${f.parent!.titleName}: ${lit(`${f.parent!.label} one`)} }], meta: { page: 1, pageSize: 50, total: 1, pageCount: 1 } })),\n}));`,
    )
    .join("\n");
  const dto = `{ id: "item-1", ...${JSON.stringify(Object.fromEntries(r.fields.map((f) => [f.name, sampleValue(f)])))}${relationDto}, createdAt: "2026-11-03T12:00:00.000Z", updatedAt: "2026-11-03T12:00:00.000Z" }`;
  const titleValue = String(sample[r.title.name]);

  return `${header(r)}import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ${r.Name}Dto } from "@/contracts/${r.kebab}";
import { create${r.Name}, list${r.Plural} } from "@/features/${r.pluralKebab}/api";
import { ${r.Plural}Panel } from "@/features/${r.pluralKebab}/components/${r.pluralKebab}-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/${r.pluralKebab}/api", () => ({
${api.map((op) => `  ${fnName(op)}: vi.fn(),`).join("\n")}
}));
${parentMocks}

const mockedList = vi.mocked(list${r.Plural});
const mockedCreate = vi.mocked(create${r.Name});
const meta = (total: number) => ({ page: 1, pageSize: ${r.pageSize}, total, pageCount: Math.max(1, Math.ceil(total / ${r.pageSize})) });
const item: ${r.Name}Dto = ${dto};

beforeEach(() => {
  mockedList.mockReset();
  mockedCreate.mockReset();
});

describe("${r.Plural}Panel", () => {
  it("shows loading, then the empty state", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof list${r.Plural}>>) => void;
    mockedList.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<${r.Plural}Panel />);
    expect(screen.getByRole("status", { name: ${lit(`Loading ${r.pluralLabelLower}`)} })).toBeInTheDocument();

    resolve({ data: [], meta: meta(0) });
    expect(await screen.findByText(${lit(`No ${r.pluralLabelLower} yet`)})).toBeVisible();
    expect(mockedList).toHaveBeenCalledWith({ page: 1, pageSize: ${r.pageSize} });
  });

  it("shows an error with a working retry", async () => {
    const user = userEvent.setup();
    mockedList.mockRejectedValueOnce(new Error("Server unavailable"));
    mockedList.mockResolvedValueOnce({ data: [item], meta: meta(1) });

    render(<${r.Plural}Panel />);
    expect(await screen.findByText("Server unavailable")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: ${lit(titleValue)} })).toBeVisible();
  });

  it("validates required fields without calling the API", async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue({ data: [], meta: meta(0) });

    render(<${r.Plural}Panel />);
    await screen.findByText(${lit(`No ${r.pluralLabelLower} yet`)});
    await user.click(screen.getByRole("button", { name: ${lit(`Create ${r.labelLower}`)} }));

    expect(await screen.findByText(${lit(`${r.title.label} is required.`)})).toBeVisible();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("creates from the form and shows the new item first", async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue({ data: [], meta: meta(0) });
    mockedCreate.mockResolvedValue(item);

    render(<${r.Plural}Panel />);
    await screen.findByText(${lit(`No ${r.pluralLabelLower} yet`)});

${r.fields.map((f) => fillComponent(f, sample[f.name])).filter(Boolean).join("\n")}
    await user.click(screen.getByRole("button", { name: ${lit(`Create ${r.labelLower}`)} }));

    expect(await screen.findByText(${lit(`${r.label} created.`)})).toBeVisible();
    expect(mockedCreate).toHaveBeenCalledWith(${JSON.stringify(sample)});
    expect(await screen.findByRole("heading", { name: ${lit(titleValue)} })).toBeVisible();
  });
});
`;
}

// ---------- API ----------

/** Generated helper code creating one owned parent record per relation (cached per request context). */
function parentHelpers(r: Resource): string {
  if (!r.relations.length) return "";
  const creators = r.relations
    .map((f) => {
      const p = f.parent!;
      return `async function create${p.Name}(request: APIRequestContext) {
  const response = await request.post(${lit(`/api/${p.pluralKebab}`)}, { data: { ...${JSON.stringify(p.sample)}, ${p.titleName}: uniq(${lit(String(p.sample[p.titleName] ?? p.label))}, ${p.titleMaxLength}) } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as { id: string; ${p.titleName}: string };
}`;
    })
    .join("\n\n");
  const required = r.relations.filter((f) => !f.createOptional);
  return `
const uniq = (prefix: string, max: number) => \`\${prefix.slice(0, Math.max(0, max - 9))} \${randomUUID().slice(0, 8)}\`.trim().slice(0, max);

${creators}

const parentCache = new WeakMap<APIRequestContext, Promise<Record<string, string>>>();
/** One parent of each kind per user (request context), created on first use. */
function parents(request: APIRequestContext) {
  if (!parentCache.has(request)) {
    parentCache.set(request, (async () => ({
${r.relations.map((f) => `      ${f.name}: (await create${f.parent!.Name}(request)).id,`).join("\n")}
    }))());
  }
  return parentCache.get(request)!;
}
${
  required.length
    ? `
/** Only the parents create cannot omit. */
async function requiredParents(request: APIRequestContext) {
  const all = await parents(request);
  return { ${required.map((f) => `${f.name}: all.${f.name}`).join(", ")} };
}
`
    : ""
}`;
}

const requiredParentsSpread = (r: Resource) =>
  r.relations.some((f) => !f.createOptional) ? "...(await requiredParents(request)), " : "";

function relationTests(r: Resource): string {
  const RP = requiredParentsSpread(r);
  return r.relations
    .map((f) => {
      const p = f.parent!;
      const childPath = "`${BASE}?" + f.name + "=${encodeURIComponent(a.id)}&pageSize=50`";
      const deleteCheck = p.canDelete
        ? `
  test(${lit(`deleting the ${p.labelLower} ${f.nullable ? "clears" : "deletes"} its ${r.pluralLabelLower}`)}, async ({ request }) => {
    const parent = await create${p.Name}(request);
    const created = ${r.Name}DtoSchema.parse((await (await request.post(BASE, { data: { ...sample, ${RP}${f.name}: parent.id, ${r.title.name}: unique("Child") } })).json()).data);
    expect((await request.delete(\`/api/${p.pluralKebab}/\${parent.id}\`)).status()).toBe(204);
    const list = List${r.Plural}ResponseSchema.parse(await (await request.get(\`\${BASE}?pageSize=50\`)).json()).data;
    ${f.nullable ? `expect(list.find((item) => item.id === created.id)?.${f.name}).toBeNull();` : `expect(list.map((item) => item.id)).not.toContain(created.id);`}
  });
`
        : "";
      return `
  test(${lit(`rejects a ${f.name} the user does not own or that does not exist`)}, async ({ request, playwright, baseURL }) => {
    const other = await playwright.request.newContext({ baseURL });
    try {
      await registerTestUser(other);
      const foreign = await create${p.Name}(other);
      for (const id of [foreign.id, "does-not-exist"]) {
        const response = await request.post(BASE, { data: { ...sample, ...(await parents(request)), ${f.name}: id, ${r.title.name}: unique("Foreign") } });
        expect(response.status(), id).toBe(400);
        expect((await response.json()).error.fieldErrors?.${f.name}?.length, id).toBeGreaterThan(0);
      }${
        r.ops.update
          ? `
      const mine = ${r.Name}DtoSchema.parse((await (await request.post(BASE, { data: { ...sample, ...(await parents(request)), ${r.title.name}: unique("Mine") } })).json()).data);
      const moved = await request.patch(\`\${BASE}/\${mine.id}\`, { data: { ${f.name}: foreign.id } });
      expect(moved.status()).toBe(400);`
          : ""
      }
    } finally {
      await other.dispose();
    }
  });

  test(${lit(`includes the ${p.labelLower} and filters by ${f.name}`)}, async ({ request }) => {
    const a = await create${p.Name}(request);
    const b = await create${p.Name}(request);
    const base = { ...sample, ${RP}};
    const inA = ${r.Name}DtoSchema.parse((await (await request.post(BASE, { data: { ...base, ${f.name}: a.id, ${r.title.name}: unique("In A") } })).json()).data);
    await request.post(BASE, { data: { ...base, ${f.name}: b.id, ${r.title.name}: unique("In B") } });
    expect(inA.${f.relation}).toEqual({ id: a.id, label: a.${p.titleName} });

    const filtered = List${r.Plural}ResponseSchema.parse(await (await request.get(${childPath})).json()).data;
    expect(filtered.map((item) => item.id)).toEqual([inA.id]);
  });
${deleteCheck}`;
    })
    .join("");
}

export function apiTest(r: Resource): string {
  const sample = Object.fromEntries(Object.entries(sampleObject(r)).filter(([name]) => !r.relations.some((f) => f.name === name)));
  const edited = Object.fromEntries(Object.entries(sampleObject(r, 1)).filter(([name]) => !r.relations.some((f) => f.name === name)));
  const P = r.relations.length ? "...(await parents(request)), " : "";
  const PR = requiredParentsSpread(r);
  const minimal = Object.fromEntries(Object.entries(minimalObject(r)).filter(([name]) => !r.relations.some((f) => f.name === name)));
  const invalid = r.fields.flatMap((f) =>
    invalidSamples(f).map(([label, value]) => `    { label: ${lit(label)}, body: withField(${lit(f.name)}, ${js(value)}), field: ${lit(f.name)} },`),
  );
  const nullable = r.fields.filter((f) => f.nullable);
  const omitted = Object.fromEntries(r.fields.filter((f) => f.createOptional).map((f) => [f.name, omittedValue(f)]));
  const searchField = r.searchFields[0];

  return `${header(r)}import { randomUUID } from "node:crypto";
import { expect, test${r.relations.length ? ", type APIRequestContext" : ""} } from "@playwright/test";
import { List${r.Plural}ResponseSchema, ${r.Name}DtoSchema } from "../../src/contracts/${r.kebab}";
import { registerTestUser } from "../helpers/auth";
import { describeOwnedResource } from "../helpers/owned-resource";

const BASE = ${lit(`/api/${r.pluralKebab}`)};
const OMIT = Symbol("omit");
const sample = ${JSON.stringify(sample)};
const edited = ${JSON.stringify(edited)};

/** Unique value within the title field's length limit. */
const unique = (prefix: string) => \`\${prefix.slice(0, ${Math.max(0, r.title.type === "string" ? r.title.maxLength - 9 : 0)})} \${randomUUID().slice(0, 8)}\`.trim().slice(0, ${r.title.type === "string" ? r.title.maxLength : 100});

function withField(field: string, value: unknown) {
  const body: Record<string, unknown> = { ...sample };
  if (value === OMIT) delete body[field];
  else body[field] = value;
  return body;
}
${parentHelpers(r)}
describeOwnedResource({
  basePath: BASE,${r.relations.length ? "\n  prepare: parents," : ""}
  operations: ${JSON.stringify(r.spec.operations)},
  validCreate: () => ({ ...sample, ${r.title.name}: unique(sample.${r.title.name}) }),
  validUpdate: () => ({ ${r.title.name}: unique(edited.${r.title.name}) }),
  invalidCreates: [
${invalid.join("\n")}
    { label: "array body", body: [] },
  ],
  itemSchema: ${r.Name}DtoSchema,
  listSchema: List${r.Plural}ResponseSchema,
});

test.describe(${lit(`/api/${r.pluralKebab} specifics`)}, () => {
  test.beforeEach(async ({ request }) => {
    await registerTestUser(request);
  });

  test("round-trips every field", async ({ request }) => {
    const body = { ...sample, ${P}${r.title.name}: unique(sample.${r.title.name}) };
    const response = await request.post(BASE, { data: body });
    expect(response.status(), await response.text()).toBe(201);
    const created = ${r.Name}DtoSchema.parse((await response.json()).data);
    expect(created).toMatchObject(body);
${
  r.ops.detail
    ? `
    const fetched = await request.get(\`\${BASE}/\${created.id}\`);
    expect(fetched.status()).toBe(200);
    expect((await fetched.json()).data).toEqual(created);
`
    : ""
}  });
${
  Object.keys(omitted).length
    ? `
  test("omitted optional fields are stored as null or their default", async ({ request }) => {
    const response = await request.post(BASE, { data: { ...${JSON.stringify(minimal)}, ${PR}${r.title.name}: unique("Minimal") } });
    expect(response.status(), await response.text()).toBe(201);
    expect(${r.Name}DtoSchema.parse((await response.json()).data)).toMatchObject(${JSON.stringify(omitted)});
  });
`
    : ""
}${
  r.ops.update
    ? `
  test("updates every field${nullable.length ? " and clears optional fields with null" : ""}", async ({ request }) => {
    const created = ${r.Name}DtoSchema.parse((await (await request.post(BASE, { data: { ...sample, ${P}${r.title.name}: unique("Before") } })).json()).data);

    const patch = { ...edited, ${r.title.name}: unique(edited.${r.title.name}) };
    const updated = await request.patch(\`\${BASE}/\${created.id}\`, { data: patch });
    expect(updated.status(), await updated.text()).toBe(200);
    expect(${r.Name}DtoSchema.parse((await updated.json()).data)).toMatchObject(patch);
${
  nullable.length
    ? `
    const cleared = await request.patch(\`\${BASE}/\${created.id}\`, { data: ${JSON.stringify(Object.fromEntries(nullable.map((f) => [f.name, null])))} });
    expect(cleared.status(), await cleared.text()).toBe(200);
    expect(${r.Name}DtoSchema.parse((await cleared.json()).data)).toMatchObject(${JSON.stringify(Object.fromEntries(nullable.map((f) => [f.name, null])))});
`
    : ""
}  });
`
    : ""
}
  test(${lit(`search matches ${searchField.name} case-insensitively and only returns matches`)}, async ({ request }) => {
    const token = randomUUID().slice(0, 8);
    const match = { ...sample, ${P}${searchField.isTitle ? `${r.title.name}: ${searchSample(searchField)}` : `${r.title.name}: unique("Match"), ${searchField.name}: ${searchSample(searchField)}`} };
    await request.post(BASE, { data: match });
    await request.post(BASE, { data: { ...sample, ${P}${r.title.name}: unique("Other") } });

    const response = await request.get(\`\${BASE}?q=\${encodeURIComponent(token.toUpperCase())}\`);
    expect(response.status()).toBe(200);
    const found = List${r.Plural}ResponseSchema.parse(await response.json()).data;
    expect(found.map((item) => item.${r.title.name})).toEqual([match.${r.title.name}]);
  });
${relationTests(r)}});
`;
}

/** Code expression producing a valid value for a searchable field that contains `token`. */
function searchSample(f: Field): string {
  switch (f.type) {
    case "email":
      return "`find-${token}@example.com`";
    case "url":
      return "`https://example.com/${token}`";
    default: {
      const max = f.type === "string" || f.type === "text" ? f.maxLength : 100;
      return `\`Find \${token}\`.slice(0, ${max})`;
    }
  }
}

// ---------- E2E ----------

function fillE2e(f: Field, value: unknown): string {
  const target = `field(page, ${lit(f.labelPattern)})`;
  switch (formKind(f)) {
    case "reference":
      return `  await ${target}.selectOption({ label: ${f.relation}Parent.${f.parent!.titleName} });`;
    case "select":
      return `  await ${target}.selectOption(${lit(String(value))});`;
    case "checkbox":
      return `  await ${target}.setChecked(${Boolean(value)});`;
    default:
      return `  await ${target}.fill(${lit(String(value))});`;
  }
}

export function e2eTest(r: Resource): string {
  const sample = sampleObject(r);
  const path = `/${r.pluralKebab}`;
  return `${header(r)}import { randomUUID } from "node:crypto";
import { expect, test, type Page${r.relations.length ? ", type APIRequestContext" : ""} } from "@playwright/test";
import { registerTestUser, signInThroughUi } from "../helpers/auth";
${r.relations
  .map(
    (f) => `
async function create${f.parent!.Name}(request: APIRequestContext) {
  const body = { ...${JSON.stringify(f.parent!.sample)}, ${f.parent!.titleName}: \`${String(f.parent!.sample[f.parent!.titleName] ?? f.parent!.label).slice(0, Math.max(0, f.parent!.titleMaxLength - 9))} \${randomUUID().slice(0, 8)}\`.trim().slice(0, ${f.parent!.titleMaxLength}) };
  const response = await request.post(${lit(`/api/${f.parent!.pluralKebab}`)}, { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as { id: string; ${f.parent!.titleName}: string };
}`,
  )
  .join("\n")}

// Hidden previous routes stay mounted under Cache Components, so only visible fields are targeted.
const field = (page: Page, pattern: string) => page.getByLabel(new RegExp(pattern)).filter({ visible: true });

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("[browser error]", error.message));
});

test(${lit(`creates a ${r.labelLower} through the form and it survives reload`)}, async ({ page, request }) => {
  const title = \`${String(sample[r.title.name]).slice(0, r.title.type === "string" ? Math.max(0, r.title.maxLength - 9) : 0)} \${randomUUID().slice(0, 8)}\`.trim().slice(0, ${r.title.type === "string" ? r.title.maxLength : 100});
  const credentials = await registerTestUser(request);
${r.relations.map((f) => `  const ${f.relation}Parent = await create${f.parent!.Name}(request);`).join("\n")}
  await signInThroughUi(page, credentials);
  await page.goto(${lit(path)});
  await expect(page.getByText(${lit(`No ${r.pluralLabelLower} yet`)})).toBeVisible();

${r.fields.map((f) => (f.isTitle ? `  await ${`field(page, ${lit(f.labelPattern)})`}.fill(title);` : fillE2e(f, sample[f.name]))).join("\n")}
  await page.getByRole("button", { name: ${lit(`Create ${r.labelLower}`)} }).click();
  await expect(page.getByText(${lit(`${r.label} created.`)}, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
${
  r.ops.detail
    ? `
  await page.getByRole("link", { name: \`Open \${title}\` }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
`
    : ""
}${
  r.ops.update
    ? `
  const renamed = \`\${title.slice(0, ${r.title.type === "string" ? Math.max(1, r.title.maxLength - 2) : 98})} 2\`;
  await field(page, ${lit(r.title.labelPattern)}).fill(renamed);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(${lit(`${r.label} saved.`)}, { exact: true })).toBeVisible();
  await page.reload();
  await expect(field(page, ${lit(r.title.labelPattern)})).toHaveValue(renamed);
`
    : ""
}${
  r.ops.delete
    ? `
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: ${lit(`Delete ${r.labelLower}`)} }).click();
${r.ops.detail ? `  await expect(page).toHaveURL(new RegExp(${lit(`${path}$`)}));\n` : ""}  await expect(page.getByText(${lit(`No ${r.pluralLabelLower} yet`)})).toBeVisible();
  await page.reload();
  await expect(page.getByText(${lit(`No ${r.pluralLabelLower} yet`)})).toBeVisible();
`
    : ""
}});
`;
}
