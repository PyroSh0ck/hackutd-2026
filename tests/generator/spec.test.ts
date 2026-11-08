// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- these tests mutate raw, untyped JSON specs on purpose */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateSpec } from "../../generator/spec";

const task = JSON.parse(readFileSync("generator/examples/task.json", "utf8"));
const clone = () => structuredClone(task);

function issuesFor(mutate: (spec: Record<string, any>) => void) {
  const spec = clone();
  mutate(spec);
  const result = validateSpec(spec);
  return result.ok ? [] : result.issues;
}

describe("feature spec validation", () => {
  it("accepts the Tasks spec and applies defaults", () => {
    const result = validateSpec(task);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.fields.find((f) => f.name === "notes")).toMatchObject({ required: false, maxLength: 1000 });
      expect(result.spec.fields.find((f) => f.name === "flagged")).toMatchObject({ default: false });
    }
  });

  it.each([
    ["unknown top-level key", (s: any) => (s.path = "src/evil.ts")],
    ["unknown field key", (s: any) => (s.fields[0].className = "x")],
    ["code-like field key", (s: any) => (s.fields[0].onClick = "alert(1)")],
    ["path traversal name", (s: any) => (s.name = "../etc")],
    ["slash in plural", (s: any) => (s.plural = "tasks/admin")],
    ["uppercase name", (s: any) => (s.name = "Task")],
    ["kebab name", (s: any) => (s.name = "my-task")],
    ["reserved resource (user)", (s: any) => (s.name = "user")],
    ["existing auth model (session)", (s: any) => ((s.name = "session"), (s.plural = "sessionItems"))],
    ["JS reserved name", (s: any) => (s.name = "delete")],
    ["plural same as name", (s: any) => (s.plural = "task")],
    ["reserved field ownerId", (s: any) => (s.fields[1].name = "ownerId")],
    ["reserved field id", (s: any) => (s.fields[1].name = "id")],
    ["prototype field", (s: any) => (s.fields[1].name = "constructor")],
    ["duplicate field", (s: any) => (s.fields[1].name = "title")],
    ["unsupported field type", (s: any) => (s.fields[1].type = "json")],
    ["boolean with required", (s: any) => (s.fields[5].required = true)],
    ["markup in label", (s: any) => (s.fields[0].label = "<script>")],
    ["braces in label", (s: any) => (s.label = "Task {x}")],
    ["backtick in label", (s: any) => (s.pluralLabel = "Tasks`")],
    ["quote in label", (s: any) => (s.label = 'Task"')],
    ["titleField unknown", (s: any) => (s.list.titleField = "nope")],
    ["titleField optional", (s: any) => (s.fields[0].required = false)],
    ["titleField not string", (s: any) => (s.list.titleField = "notes")],
    ["search on int", (s: any) => (s.list.searchFields = ["estimateHours"])],
    ["update without detail", (s: any) => (s.operations = ["create", "list", "update"])],
    ["missing create", (s: any) => (s.operations = ["list", "detail"])],
    ["duplicate operation", (s: any) => (s.operations = ["create", "list", "list"])],
    ["unknown operation", (s: any) => (s.operations = ["create", "list", "export"])],
    ["unsupported layout", (s: any) => (s.layout = "kanban")],
    ["unsupported ownership", (s: any) => (s.ownership = "public")],
    ["enum default not in values", (s: any) => (s.fields[2].default = "blocked")],
    ["enum duplicate values", (s: any) => s.fields[2].values.push({ value: "todo", label: "Again" })],
    ["enum value not snake_case", (s: any) => (s.fields[2].values[0].value = "To Do")],
    ["int min > max", (s: any) => ((s.fields[4].min = 10), (s.fields[4].max = 1))],
    ["int default out of range", (s: any) => (s.fields[4].default = 5000)],
    ["impossible date bound", (s: any) => (s.fields[3].min = "2026-02-30")],
    ["string maxLength too large", (s: any) => (s.fields[0].maxLength = 100000)],
    ["wrong version", (s: any) => (s.version = 2)],
    ["no fields", (s: any) => (s.fields = [])],
  ])("rejects %s", (_label, mutate) => {
    expect(issuesFor(mutate).length).toBeGreaterThan(0);
  });

  it("rejects decimals with more places than scale", () => {
    const issues = issuesFor((s) => s.fields.push({ name: "amount", type: "decimal", scale: 2, default: 1.005 }));
    expect(issues.join("\n")).toMatch(/at most 2 decimal places/);
  });

  it("reports readable paths for nested issues", () => {
    const issues = issuesFor((s) => (s.fields[2].default = "blocked"));
    expect(issues).toContain("fields.2.default: default must be one of values.");
  });
});
