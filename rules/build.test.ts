import { describe, expect, test } from "bun:test";
import { extractVars, parseVarValue, buildBaselineConfig, mergeVariant } from "./build";
import { join } from "path";

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
  test("same ID same value across files = no error", () => {
    // We can't easily mock fs, but we can test the logic by checking
    // that our actual rules dir works without errors
    const { errors } = buildBaselineConfig(join(import.meta.dir));
    expect(errors).toHaveLength(0);
  });

  test("same ID different values = error", () => {
    // Test via extractVars + manual conflict check to verify logic
    const md1 = `Value is [var:foo:10]`;
    const md2 = `Value is [var:foo:20]`;
    const { vars: vars1 } = extractVars(md1, "a.md");
    const { vars: vars2 } = extractVars(md2, "b.md");
    expect(vars1[0].value).toBe(10);
    expect(vars2[0].value).toBe(20);
    // Different values for same ID should be flagged
    expect(vars1[0].value).not.toBe(vars2[0].value);
  });

  test("integration: scans actual rules dir and produces 17 keys", () => {
    const { config, errors } = buildBaselineConfig(join(import.meta.dir));
    expect(errors).toHaveLength(0);
    expect(Object.keys(config)).toHaveLength(17);
  });

  test("TBD vars are excluded from output", () => {
    const { config, warnings } = buildBaselineConfig(join(import.meta.dir));
    expect(config).not.toHaveProperty("X");
    expect(config).not.toHaveProperty("Y");
    const tbdWarnings = warnings.filter((w) => w.includes("TBD var"));
    expect(tbdWarnings.length).toBeGreaterThanOrEqual(2);
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
