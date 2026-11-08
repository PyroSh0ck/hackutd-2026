// Resolves a validated FeatureSpec into names and per-field code fragments.
// Every user-supplied string reaches generated code through `lit()` (JSON string literal).
import type { FeatureSpec, FieldSpec } from "./spec";

export const lit = (value: string | number | boolean) => JSON.stringify(value);

const pascal = (camel: string) => camel[0].toUpperCase() + camel.slice(1);
const kebab = (camel: string) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const humanize = (camel: string) => {
  const words = camel.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
  return words[0].toUpperCase() + words.slice(1);
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const INT_LIMIT = 2_147_483_647;
const DECIMAL_LIMIT = 999_999_999;

export type Field = FieldSpec & {
  label: string;
  /** No value allowed: omitted/null/blank are stored as null. */
  nullable: boolean;
  /** Create may omit this field. */
  createOptional: boolean;
  isTitle: boolean;
  /** Regex source matching the rendered label text (with optional required marker). */
  labelPattern: string;
  /** belongsTo only: the parent resource and the relation name (field name without "Id"). */
  parent?: ParentRef;
  relation?: string;
};

/** What a child needs to know about a generated parent resource. */
export type ParentRef = {
  name: string; // project
  Name: string; // Project
  plural: string; // projects
  Plural: string; // Projects
  kebab: string; // project
  pluralKebab: string; // projects
  label: string; // Project
  labelLower: string;
  titleName: string; // name of the parent's title field
  canDelete: boolean;
  /** Valid create body for the parent (sample values), used by generated tests. */
  sample: Record<string, unknown>;
  titleMaxLength: number;
};

export function parentRef(r: Resource): ParentRef {
  return {
    name: r.name,
    Name: r.Name,
    plural: r.plural,
    Plural: r.Plural,
    kebab: r.kebab,
    pluralKebab: r.pluralKebab,
    label: r.label,
    labelLower: r.labelLower,
    titleName: r.title.name,
    canDelete: r.ops.delete,
    sample: Object.fromEntries(r.fields.filter((f) => f.type !== "belongsTo").map((f) => [f.name, sampleValue(f)])),
    titleMaxLength: r.title.type === "string" ? r.title.maxLength : 100,
  };
}

export type Resource = {
  spec: FeatureSpec;
  name: string; // task
  plural: string; // tasks
  Name: string; // Task
  Plural: string; // Tasks
  kebab: string; // task
  pluralKebab: string; // tasks
  label: string; // Task
  pluralLabel: string; // Tasks
  labelLower: string; // task
  pluralLabelLower: string; // tasks
  description: string;
  ops: Record<"create" | "list" | "detail" | "update" | "delete", boolean>;
  hasItemRoute: boolean;
  fields: Field[];
  title: Field;
  searchFields: Field[];
  pageSize: number;
  /** belongsTo fields (parents resolved). */
  relations: Field[];
};

/**
 * `parents` maps parent resource names to resolved refs. Missing parents get a placeholder
 * so rendering never crashes; the planner reports them as conflicts before anything is written.
 */
export function resolve(spec: FeatureSpec, parents: Record<string, ParentRef> = {}): Resource {
  const fields: Field[] = spec.fields.map((field) => {
    const parent =
      field.type === "belongsTo"
        ? (parents[field.resource] ?? placeholderParent(field.resource))
        : undefined;
    const label = field.label ?? (parent ? parent.label : humanize(field.name));
    const required = field.type === "boolean" ? true : field.required;
    const hasDefault = "default" in field && field.default !== undefined;
    const nullable = field.type !== "boolean" && !required && !hasDefault;
    return {
      ...field,
      label,
      nullable,
      createOptional: field.type === "boolean" || !required || hasDefault,
      isTitle: field.name === spec.list.titleField,
      labelPattern: `^${escapeRegExp(label)}( \\*)?$`,
      ...(parent ? { parent, relation: field.name.slice(0, -2) } : {}),
    };
  });
  const ops = Object.fromEntries(
    (["create", "list", "detail", "update", "delete"] as const).map((op) => [op, spec.operations.includes(op)]),
  ) as Resource["ops"];
  const title = fields.find((field) => field.isTitle)!;
  const searchNames = spec.list.searchFields ?? [title.name];

  return {
    spec,
    name: spec.name,
    plural: spec.plural,
    Name: pascal(spec.name),
    Plural: pascal(spec.plural),
    kebab: kebab(spec.name),
    pluralKebab: kebab(spec.plural),
    label: spec.label,
    pluralLabel: spec.pluralLabel,
    labelLower: spec.label.toLowerCase(),
    pluralLabelLower: spec.pluralLabel.toLowerCase(),
    description: spec.description ?? `${spec.pluralLabel} you own.`,
    ops,
    hasItemRoute: ops.detail || ops.update || ops.delete,
    fields,
    title,
    searchFields: searchNames.map((name) => fields.find((field) => field.name === name)!),
    pageSize: spec.list.pageSize,
    relations: fields.filter((field) => field.type === "belongsTo"),
  };
}

function placeholderParent(name: string): ParentRef {
  const Name = pascal(name);
  return {
    name, Name, plural: `${name}s`, Plural: `${Name}s`, kebab: kebab(name), pluralKebab: `${kebab(name)}s`,
    label: Name, labelLower: name, titleName: "name", canDelete: false, sample: {}, titleMaxLength: 100,
  };
}

// ---------- contracts (Zod) ----------

/** Zod expression for a present, non-null value of the field. */
export function zodValue(f: Field): string {
  const L = f.label;
  switch (f.type) {
    case "string":
    case "text": {
      const min = f.required ? `.min(1, ${lit(`${L} is required.`)})` : "";
      return `z.string({ error: ${lit(`${L} must be text.`)} }).trim()${min}.max(${f.maxLength}, ${lit(`${L} must be ${f.maxLength} characters or fewer.`)})`;
    }
    case "email":
      return `z.string({ error: ${lit(`${L} must be text.`)} }).trim()${f.required ? `.min(1, ${lit(`${L} is required.`)})` : ""}.max(254, ${lit(`${L} must be 254 characters or fewer.`)}).pipe(z.email(${lit(`Enter a valid email address for ${L}.`)}))`;
    case "url":
      return `z.string({ error: ${lit(`${L} must be text.`)} }).trim()${f.required ? `.min(1, ${lit(`${L} is required.`)})` : ""}.max(2048, ${lit(`${L} must be 2048 characters or fewer.`)}).pipe(z.url({ protocol: /^https?$/, error: ${lit(`${L} must be an http(s) URL.`)} }))`;
    case "int": {
      const min = f.min ?? -INT_LIMIT;
      const max = f.max ?? INT_LIMIT;
      return `numberValue(${lit(L)}).int(${lit(`${L} must be a whole number.`)}).min(${min}, ${lit(`${L} must be at least ${min}.`)}).max(${max}, ${lit(`${L} must be at most ${max}.`)})`;
    }
    case "decimal": {
      const min = f.min ?? -DECIMAL_LIMIT;
      const max = f.max ?? DECIMAL_LIMIT;
      return `numberValue(${lit(L)}).min(${min}, ${lit(`${L} must be at least ${min}.`)}).max(${max}, ${lit(`${L} must be at most ${max}.`)}).refine((value) => hasAtMostDecimals(value, ${f.scale}), ${lit(`${L} can have at most ${f.scale} decimal places.`)})`;
    }
    case "boolean":
      return `z.boolean({ error: ${lit(`${L} must be true or false.`)} })`;
    case "date": {
      const bounds = [f.min ? `min: ${lit(f.min)}` : "", f.max ? `max: ${lit(f.max)}` : ""].filter(Boolean).join(", ");
      return `isoDate(${lit(L)}${bounds ? `, { ${bounds} }` : ""})`;
    }
    case "enum":
      return `z.enum(${upperSnake(f.name)}_VALUES, { error: ${lit(`Choose a valid ${L}.`)} })`;
    case "belongsTo":
      return `z.string({ error: ${lit(`Choose a ${L}.`)} }).trim()${f.required ? `.min(1, ${lit(`${L} is required.`)})` : ""}.max(64, ${lit(`Choose a valid ${L}.`)}).regex(/^[A-Za-z0-9_-]+$/, ${lit(`Choose a valid ${L}.`)})`;
  }
}

export function zodCreate(f: Field): string {
  if (f.nullable) return `optionalValue(${zodValue(f)}).optional()`;
  if (f.createOptional) return `${zodValue(f)}.optional()`;
  return zodValue(f);
}

export function zodUpdate(f: Field): string {
  return f.nullable ? `optionalValue(${zodValue(f)}).optional()` : `${zodValue(f)}.optional()`;
}

export function zodDto(f: Field): string {
  const base =
    f.type === "int" || f.type === "decimal"
      ? "z.number()"
      : f.type === "boolean"
        ? "z.boolean()"
        : f.type === "enum"
          ? `z.enum(${upperSnake(f.name)}_VALUES)`
          : "z.string()";
  return f.nullable ? `${base}.nullable()` : base;
}

export const upperSnake = (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
/** TS type name for an enum field's values, e.g. status -> StatusValue. */
export const enumType = (f: Field) => `${pascal(f.name)}Value`;

const shiftDate = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// ---------- Prisma ----------

export function prismaField(f: Field): string {
  const q = f.nullable ? "?" : "";
  const def = "default" in f && f.default !== undefined ? ` @default(${typeof f.default === "string" ? lit(f.default) : f.default})` : "";
  switch (f.type) {
    case "string":
      return `${f.name} String${q} @db.VarChar(${f.maxLength})`;
    case "text":
      return `${f.name} String${q} @db.Text`;
    case "email":
      return `${f.name} String${q} @db.VarChar(254)`;
    case "url":
      return `${f.name} String${q} @db.VarChar(2048)`;
    case "int":
      return `${f.name} Int${q}${def}`;
    case "decimal":
      return `${f.name} Decimal${q} @db.Decimal(${9 + f.scale}, ${f.scale})${def}`;
    case "boolean":
      return `${f.name} Boolean${def}`;
    case "date":
      return `${f.name} DateTime${q} @db.Date`;
    case "enum":
      return `${f.name} String${q} @db.VarChar(40)${def}`;
    case "belongsTo": {
      const p = f.parent!;
      return `${f.name} String${q}\n${f.relation} ${p.Name}${q} @relation(fields: [${f.name}], references: [id], onDelete: ${f.nullable ? "SetNull" : "Cascade"})`;
    }
  }
}

// ---------- service conversions ----------

/** Expression converting a Prisma row value (`row.<name>`) to its DTO value. */
export function toDtoExpr(f: Field, row = "row"): string {
  const v = `${row}.${f.name}`;
  if (f.type === "decimal") return f.nullable ? `${v} === null ? null : ${v}.toNumber()` : `${v}.toNumber()`;
  if (f.type === "date") return f.nullable ? `${v} === null ? null : toIsoDate(${v})` : `toIsoDate(${v})`;
  if (f.type === "enum") return `${v} as ${enumType(f)}${f.nullable ? " | null" : ""}`;
  return v;
}

/** Expression converting a validated input value (`v`) to a Prisma write value. */
export function toDataExpr(f: Field, v: string): string {
  if (f.type === "date") return f.nullable ? `${v} === null ? null : fromIsoDate(${v})` : `fromIsoDate(${v})`;
  return v;
}

// ---------- form ----------

export type FormKind = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "reference";

export function formKind(f: Field): FormKind {
  switch (f.type) {
    case "text":
      return "textarea";
    case "int":
    case "decimal":
      return "number";
    case "date":
      return "date";
    case "enum":
      return "select";
    case "boolean":
      return "checkbox";
    case "belongsTo":
      return "reference";
    default:
      return "text";
  }
}

/** TS type of the field in react-hook-form state. */
export const formValueType = (f: Field) => (f.type === "boolean" ? "boolean" : "string");

/** Empty form default (create mode). */
export function formDefault(f: Field): string {
  if (f.type === "boolean") return lit(f.default);
  if ("default" in f && f.default !== undefined) return lit(String(f.default));
  return lit("");
}

/** Form value from a DTO (`item.<name>`), for edit mode. */
export function formFromDto(f: Field, item = "item"): string {
  const v = `${item}.${f.name}`;
  if (f.type === "boolean") return v;
  if (f.type === "int" || f.type === "decimal") return f.nullable ? `${v} === null ? "" : String(${v})` : `String(${v})`;
  return f.nullable ? `${v} ?? ""` : v;
}

/** Payload value from form state (`values.<name>`). `mode` matters for defaults. */
export function payloadFromForm(f: Field, mode: "create" | "update", values = "values"): string {
  const v = `${values}.${f.name}`;
  const empty = f.nullable ? "null" : mode === "create" && f.createOptional ? "undefined" : "null";
  switch (f.type) {
    case "boolean":
      return v;
    case "int":
    case "decimal":
      return `${v}.trim() === "" ? ${empty} : Number(${v})`;
    case "string":
    case "text":
    case "email":
    case "url":
      // Required text sends the trimmed (possibly empty) string so validation reports "is required".
      return f.nullable ? `${v}.trim() === "" ? null : ${v}.trim()` : `${v}.trim()`;
    default:
      return `${v} === "" ? ${empty} : ${v}`;
  }
}

/** Display expression for list/detail (`item.<name>`), returning string | number | null. */
export function displayExpr(f: Field, item = "item"): string {
  const v = `${item}.${f.name}`;
  switch (f.type) {
    case "belongsTo":
      return `${item}.${f.relation}?.label ?? null`;
    case "boolean":
      return `${v} ? "Yes" : "No"`;
    case "enum":
      return f.nullable ? `${v} === null ? null : ${upperSnake(f.name)}_LABELS[${v}]` : `${upperSnake(f.name)}_LABELS[${v}]`;
    case "decimal": {
      const fmt = `.toLocaleString("en-US", { minimumFractionDigits: ${f.scale}, maximumFractionDigits: ${f.scale} })`;
      return f.nullable ? `${v} === null ? null : ${v}${fmt}` : `${v}${fmt}`;
    }
    default:
      return v;
  }
}

// ---------- test samples ----------

const clamp = (value: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
const roundTo = (value: number, scale: number) => Math.round(value * 10 ** scale) / 10 ** scale;

/** A valid, non-default sample value (JS value, not code). */
export function sampleValue(f: Field, variant: 0 | 1 = 0): string | number | boolean {
  switch (f.type) {
    case "string":
      return `${variant ? "Edited" : "Sample"} ${f.label}`.slice(0, f.maxLength);
    case "text":
      return `${variant ? "Edited" : "Sample"} ${f.label.toLowerCase()} text`.slice(0, f.maxLength);
    case "email":
      return variant ? "edited@example.com" : "person@example.com";
    case "url":
      return variant ? "https://example.com/edited" : "https://example.com/page";
    case "int":
      return clamp(variant ? 7 : 3, f.min, f.max);
    case "decimal":
      return roundTo(clamp(variant ? 42.25 : 12.5, f.min, f.max), f.scale);
    case "boolean":
      return variant ? f.default : !f.default;
    case "date": {
      let value = variant ? "2026-03-20" : "2026-01-15";
      if (f.min && value < f.min) value = f.min;
      if (f.max && value > f.max) value = f.max;
      return value;
    }
    case "enum": {
      const values = f.values.map((v) => v.value).filter((v) => v !== f.default);
      return values[variant % values.length];
    }
    case "belongsTo":
      // Placeholder id: valid syntax for contract tests; API/E2E tests use a real parent instead.
      return variant ? "parent-2" : "parent-1";
  }
}

/** Invalid create inputs for this field: [label, value]. `undefined` means "omit the field". */
export function invalidSamples(f: Field): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  if (!f.createOptional) out.push([`missing ${f.name}`, undefined]);
  switch (f.type) {
    case "string":
    case "text":
      if (f.required) out.push([`blank ${f.name}`, "   "]);
      out.push([`${f.name} too long`, "x".repeat(f.maxLength + 1)], [`${f.name} wrong type`, 123]);
      break;
    case "email":
      out.push([`${f.name} not an email`, "not-an-email"]);
      break;
    case "url":
      out.push([`${f.name} javascript url`, "javascript:alert(1)"], [`${f.name} not a url`, "not a url"]);
      break;
    case "int":
      out.push([`${f.name} fractional`, 1.5], [`${f.name} numeric string`, "5"]);
      if (f.min !== undefined && f.min > -INT_LIMIT) out.push([`${f.name} below min`, f.min - 1]);
      if (f.max !== undefined && f.max < INT_LIMIT) out.push([`${f.name} above max`, f.max + 1]);
      break;
    case "decimal":
      if (f.scale < 4) out.push([`${f.name} too many decimals`, roundTo(clamp(1, f.min, f.max), f.scale) + 10 ** -(f.scale + 1) * 3]);
      out.push([`${f.name} numeric string`, "5"]);
      if (f.min !== undefined) out.push([`${f.name} below min`, f.min - 1]);
      if (f.max !== undefined) out.push([`${f.name} above max`, f.max + 1]);
      break;
    case "boolean":
      out.push([`${f.name} not boolean`, "yes"]);
      break;
    case "date":
      out.push([`${f.name} impossible date`, "2026-02-30"], [`${f.name} wrong format`, "01/02/2026"]);
      if (f.min) out.push([`${f.name} before min`, shiftDate(f.min, -1)]);
      if (f.max) out.push([`${f.name} after max`, shiftDate(f.max, 1)]);
      break;
    case "enum":
      out.push([`${f.name} unknown value`, "not_a_value"]);
      break;
    case "belongsTo":
      out.push([`${f.name} wrong type`, 123], [`${f.name} malformed id`, "../etc"]);
      break;
  }
  return out;
}
