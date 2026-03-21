import { describe, expect, test } from "bun:test";
import { extractVars, parseVarValue, buildBaselineConfig, mergeVariant } from "../rules-config";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

describe("parseVarValue", () => {
  test("numeric values", () => {
    expect(parseVarValue("10")).toBe(10);
    expect(parseVarValue("0")).toBe(0);
    expect(parseVarValue("3.5")).toBe(3.5);
  });

  test("boolean values", () => {
    expect(parseVarValue("true")).toBe(true);
    expect(parseVarValue("false")).toBe(false);
  });

  test("string values", () => {
    expect(parseVarValue("hello")).toBe("hello");
    expect(parseVarValue("some_thing")).toBe("some_thing");
  });
});

describe("extractVars", () => {
  test("extracts vars from markdown", () => {
    const md = `# Title
Players start with [var:starting_gold:10] gold.
Grid is [var:grid_padding:2] wide.`;
    const { vars, tbdVars } = extractVars(md, "test.md");
    expect(vars).toHaveLength(2);
    expect(vars[0]).toEqual({ id: "starting_gold", value: 10, file: "test.md", line: 2 });
    expect(vars[1]).toEqual({ id: "grid_padding", value: 2, file: "test.md", line: 3 });
    expect(tbdVars).toHaveLength(0);
  });

  test("detects TBD vars (no value)", () => {
    const md = `Main deck: [var:X] cards.`;
    const { vars, tbdVars } = extractVars(md, "test.md");
    expect(vars).toHaveLength(0);
    expect(tbdVars).toHaveLength(1);
    expect(tbdVars[0]).toEqual({ id: "X", file: "test.md", line: 1 });
  });

  test("handles multiple vars on same line", () => {
    const md = `Keep [var:seed_keep:8] and expose [var:seed_expose:2].`;
    const { vars } = extractVars(md, "test.md");
    expect(vars).toHaveLength(2);
    expect(vars[0].id).toBe("seed_keep");
    expect(vars[1].id).toBe("seed_expose");
  });
});

describe("buildBaselineConfig", () => {
  function makeTempDir(files: Record<string, string>): string {
    const dir = join(tmpdir(), `rules-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  test("same ID same value across files = no error", () => {
    const dir = makeTempDir({
      "a.md": "Value is [var:foo:10]",
      "b.md": "Value is [var:foo:10]",
    });
    const { config, errors } = buildBaselineConfig(dir);
    expect(errors).toHaveLength(0);
    expect(config.foo).toBe(10);
    rmSync(dir, { recursive: true });
  });

  test("same ID different values = error", () => {
    const dir = makeTempDir({
      "a.md": "Value is [var:foo:10]",
      "b.md": "Value is [var:foo:20]",
    });
    const { errors } = buildBaselineConfig(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("foo");
    expect(errors[0]).toContain("Conflicting");
    rmSync(dir, { recursive: true });
  });

  // Update this count when adding/removing [var:...] declarations in rules/*.md
  test("integration: scans actual rules dir and produces 17 keys", () => {
    const rulesDir = resolve(import.meta.dir, "../../../rules");
    const { config, errors } = buildBaselineConfig(rulesDir);
    expect(errors).toHaveLength(0);
    expect(Object.keys(config)).toHaveLength(17);
  });

  test("TBD vars are excluded from output", () => {
    const rulesDir = resolve(import.meta.dir, "../../../rules");
    const { config, warnings } = buildBaselineConfig(rulesDir);
    expect(config).not.toHaveProperty("X");
    expect(config).not.toHaveProperty("Y");
    const tbdWarnings = warnings.filter((w) => w.includes("TBD var"));
    expect(tbdWarnings.length).toBeGreaterThanOrEqual(2);
  });

  test("excludes CLAUDE.md from scanning", () => {
    const dir = makeTempDir({
      "rules.md": "Value is [var:foo:10]",
      "CLAUDE.md": "Example: [var:bar:99]",
    });
    const { config } = buildBaselineConfig(dir);
    expect(config).toHaveProperty("foo");
    expect(config).not.toHaveProperty("bar");
    rmSync(dir, { recursive: true });
  });
});

describe("mergeVariant", () => {
  test("merges overrides onto baseline", () => {
    const baseline = { starting_gold: 10, vp_threshold: 50 };
    const knownIds = new Set(Object.keys(baseline));
    const { config, warnings } = mergeVariant(baseline, { starting_gold: 20 }, knownIds);
    expect(config.starting_gold).toBe(20);
    expect(config.vp_threshold).toBe(50);
    expect(warnings).toHaveLength(0);
  });

  test("warns on unknown keys", () => {
    const baseline = { starting_gold: 10 };
    const knownIds = new Set(Object.keys(baseline));
    const { config, warnings } = mergeVariant(baseline, { unknown_key: 5 }, knownIds);
    expect(config.unknown_key).toBe(5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unknown_key");
  });
});
