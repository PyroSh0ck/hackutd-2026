// Feature specification v1 — the ONLY input the feature generator accepts.
// Narrow on purpose: no paths, imports, code, SQL, CSS, or arbitrary JSX can be expressed.
// Unknown keys are rejected everywhere. See generator/README.md for semantics.
import { z } from "zod";

// ---------- identifiers & display text ----------

const JS_RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends false finally for " +
    "function if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "yield let static implements interface package private protected public await arguments eval undefined NaN Infinity " +
    "constructor prototype toString valueOf hasOwnProperty __proto__"
  ).split(" "),
);

/** Resource names that collide with existing models, routes, or framework folders. */
export const RESERVED_RESOURCE_NAMES = new Set([
  "user", "users", "session", "sessions", "account", "accounts", "verification", "verifications",
  "auth", "api", "health", "playground", "signIn", "signUp", "generated",
  "component", "components", "lib", "server", "contract", "contracts", "feature", "features", "prisma",
  "test", "tests", "new", "edit", "page", "pages", "layout", "layouts", "config", "app", "public",
  "pagination", "error", "errors", "owner", "owners",
]);

/** Field names the generator itself owns. */
export const RESERVED_FIELD_NAMES = new Set([
  "id", "ownerId", "owner", "createdAt", "updatedAt", "page", "pageSize", "q", "data", "meta", "error",
]);

const identifier = (what: string, max: number) =>
  z
    .string()
    .regex(new RegExp(`^[a-z][a-zA-Z0-9]{0,${max - 1}}$`), {
      message: `${what} must be lowerCamelCase letters/digits, starting with a lowercase letter (max ${max}).`,
    })
    .refine((value) => !JS_RESERVED.has(value), { message: `${what} is a reserved JavaScript word.` });

/** Human text that is embedded in generated UI. Restricted so it is always safe as a string literal. */
const displayText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[\p{L}\p{N} .,'’()\-/&?!:%#+]+$/u, {
      message: "Use letters, numbers, spaces and basic punctuation only.",
    });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use YYYY-MM-DD." }).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
  { message: "Not a real calendar date." },
);

const INT_LIMIT = 2_147_483_647;
const DECIMAL_LIMIT = 999_999_999;

// ---------- fields ----------

const fieldBase = {
  name: identifier("Field name", 40).refine((value) => !RESERVED_FIELD_NAMES.has(value), {
    message: "Field name is reserved by the generator (id, ownerId, createdAt, updatedAt, ...).",
  }),
  label: displayText(60).optional(),
  hint: displayText(120).optional(),
};

const StringField = z
  .object({
    ...fieldBase,
    type: z.literal("string"),
    required: z.boolean().default(false),
    maxLength: z.number().int().min(1).max(500).default(100),
  })
  .strict();

const TextField = z
  .object({
    ...fieldBase,
    type: z.literal("text"),
    required: z.boolean().default(false),
    maxLength: z.number().int().min(1).max(20_000).default(2000),
  })
  .strict();

const EmailField = z.object({ ...fieldBase, type: z.literal("email"), required: z.boolean().default(false) }).strict();
const UrlField = z.object({ ...fieldBase, type: z.literal("url"), required: z.boolean().default(false) }).strict();

const IntField = z
  .object({
    ...fieldBase,
    type: z.literal("int"),
    required: z.boolean().default(false),
    min: z.number().int().min(-INT_LIMIT).max(INT_LIMIT).optional(),
    max: z.number().int().min(-INT_LIMIT).max(INT_LIMIT).optional(),
    default: z.number().int().min(-INT_LIMIT).max(INT_LIMIT).optional(),
  })
  .strict();

const DecimalField = z
  .object({
    ...fieldBase,
    type: z.literal("decimal"),
    required: z.boolean().default(false),
    scale: z.number().int().min(0).max(4).default(2),
    min: z.number().min(-DECIMAL_LIMIT).max(DECIMAL_LIMIT).optional(),
    max: z.number().min(-DECIMAL_LIMIT).max(DECIMAL_LIMIT).optional(),
    default: z.number().min(-DECIMAL_LIMIT).max(DECIMAL_LIMIT).optional(),
  })
  .strict();

const BooleanField = z
  .object({
    ...fieldBase,
    type: z.literal("boolean"),
    // Booleans are never null. `required` is meaningless, so it is rejected (strict) rather than ignored.
    default: z.boolean().default(false),
  })
  .strict();

const DateField = z
  .object({
    ...fieldBase,
    type: z.literal("date"),
    required: z.boolean().default(false),
    min: isoDate.optional(),
    max: isoDate.optional(),
  })
  .strict();

const EnumField = z
  .object({
    ...fieldBase,
    type: z.literal("enum"),
    required: z.boolean().default(false),
    values: z
      .array(
        z
          .object({
            value: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, { message: "Enum values are lower_snake_case." }),
            label: displayText(40),
          })
          .strict(),
      )
      .min(2)
      .max(20),
    default: z.string().optional(),
  })
  .strict();

const BelongsToField = z
  .object({
    ...fieldBase,
    // The foreign-key name, ending in "Id" (e.g. projectId). The relation is the name without "Id".
    name: fieldBase.name.refine((value) => /^[a-z][a-zA-Z0-9]*Id$/.test(value) && value.length > 2, {
      message: "belongsTo field names end in 'Id' (e.g. projectId).",
    }),
    type: z.literal("belongsTo"),
    /** Name of an already generated resource owned by the same user. */
    resource: identifier("Parent resource", 30),
    required: z.boolean().default(false),
  })
  .strict();

export const FieldSpecSchema = z.discriminatedUnion("type", [
  BelongsToField,
  StringField,
  TextField,
  EmailField,
  UrlField,
  IntField,
  DecimalField,
  BooleanField,
  DateField,
  EnumField,
]);

export const FIELD_TYPES = ["string", "text", "email", "url", "int", "decimal", "boolean", "date", "enum", "belongsTo"] as const;
export const OPERATIONS = ["create", "list", "detail", "update", "delete"] as const;
export const LAYOUTS = ["list-with-create-form"] as const;

// ---------- feature ----------

export const FeatureSpecSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    kind: z.literal("resource").optional(),
    name: identifier("Resource name", 30).refine((value) => !RESERVED_RESOURCE_NAMES.has(value), {
      message: "Resource name is reserved or already used by the app.",
    }),
    plural: identifier("Plural name", 31).refine((value) => !RESERVED_RESOURCE_NAMES.has(value), {
      message: "Plural name is reserved or already used by the app.",
    }),
    label: displayText(40),
    pluralLabel: displayText(40),
    description: displayText(160).optional(),
    operations: z.array(z.enum(OPERATIONS)).min(2),
    ownership: z.literal("current-user"),
    layout: z.enum(LAYOUTS),
    fields: z.array(FieldSpecSchema).min(1).max(20),
    list: z
      .object({
        titleField: z.string(),
        searchFields: z.array(z.string()).max(4).optional(),
        pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

    if (spec.plural === spec.name) issue(["plural"], "Plural must differ from name.");

    const ops = new Set(spec.operations);
    if (ops.size !== spec.operations.length) issue(["operations"], "Operations must be unique.");
    if (!ops.has("create") || !ops.has("list")) issue(["operations"], "v1 requires both 'create' and 'list'.");
    if (ops.has("update") && !ops.has("detail")) issue(["operations"], "'update' requires 'detail' (editing happens on the detail page).");

    const names = new Set<string>();
    spec.fields.forEach((field, i) => {
      if (names.has(field.name)) issue(["fields", i, "name"], `Duplicate field name '${field.name}'.`);
      names.add(field.name);

      if ((field.type === "int" || field.type === "decimal" || field.type === "date") && field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issue(["fields", i, "min"], "min must be <= max.");
      }
      if ((field.type === "int" || field.type === "decimal") && field.default !== undefined) {
        if ((field.min !== undefined && field.default < field.min) || (field.max !== undefined && field.default > field.max)) {
          issue(["fields", i, "default"], "default must be within min/max.");
        }
      }
      if (field.type === "decimal") {
        for (const key of ["min", "max", "default"] as const) {
          const value = field[key];
          if (value !== undefined && !hasAtMostDecimals(value, field.scale)) issue(["fields", i, key], `Must have at most ${field.scale} decimal places.`);
        }
      }
      if (field.type === "enum") {
        const values = field.values.map((v) => v.value);
        if (new Set(values).size !== values.length) issue(["fields", i, "values"], "Enum values must be unique.");
        if (field.default !== undefined && !values.includes(field.default)) issue(["fields", i, "default"], "default must be one of values.");
      }
    });

    const parents = new Set<string>();
    spec.fields.forEach((field, i) => {
      if (field.type !== "belongsTo") return;
      if (field.resource === spec.name) issue(["fields", i, "resource"], "A resource cannot belong to itself in v1.");
      if (parents.has(field.resource)) issue(["fields", i, "resource"], `Only one belongsTo per parent resource ('${field.resource}').`);
      parents.add(field.resource);
      const relation = field.name.slice(0, -2);
      if (names.has(relation)) issue(["fields", i, "name"], `Relation name '${relation}' collides with another field.`);
    });

    const byName = new Map(spec.fields.map((field) => [field.name, field]));
    const title = byName.get(spec.list.titleField);
    if (!title) issue(["list", "titleField"], `Unknown field '${spec.list.titleField}'.`);
    else if (title.type !== "string" || !title.required) issue(["list", "titleField"], "titleField must be a required 'string' field.");

    const searchFields = spec.list.searchFields ?? [];
    if (new Set(searchFields).size !== searchFields.length) issue(["list", "searchFields"], "Search fields must be unique.");
    searchFields.forEach((name, i) => {
      const field = byName.get(name);
      if (!field) issue(["list", "searchFields", i], `Unknown field '${name}'.`);
      else if (!["string", "text", "email", "url"].includes(field.type)) issue(["list", "searchFields", i], "Only string/text/email/url fields are searchable.");
    });
  });

export function hasAtMostDecimals(value: number, scale: number) {
  const scaled = value * 10 ** scale;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export type FeatureSpecInput = z.input<typeof FeatureSpecSchema>;
export type FeatureSpec = z.output<typeof FeatureSpecSchema>;
export type FieldSpec = z.output<typeof FieldSpecSchema>;

/** Validates a parsed JSON value. Returns readable issue strings on failure. */
export function validateSpec(input: unknown): { ok: true; spec: FeatureSpec } | { ok: false; issues: string[] } {
  const result = FeatureSpecSchema.safeParse(input);
  if (result.success) return { ok: true, spec: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`),
  };
}
