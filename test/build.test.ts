import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  transformCard,
  validate,
  type CardType,
} from "../library/build";
import { KEYWORDS } from "../engine/src/keywords";

// ---------------------------------------------------------------------------
// Build-time governed-vocabulary validation (#119)
//
// The headline feature of the `keywords` split is that build.ts rejects
// out-of-vocab values in the governed columns (`attributes`, `location_type`,
// `event_type`, item `type`) — the same way it already rejects a bad `rarity`
// or `timing`. These tests drive `validate()` directly (via `transformCard`,
// the same path `buildSet` uses) so a deleted or inverted membership check
// fails here instead of silently shipping bad data.
// ---------------------------------------------------------------------------

/** Build a raw CSV row with sensible defaults, overridable per-field. */
function row(overrides: Record<string, string>): Record<string, string> {
  return {
    id: "test-card",
    name: "Test Card",
    set: "test-set",
    rarity: "common",
    cost: "3",
    text: "",
    flavor: "",
    keywords: "",
    attributes: "",
    ...overrides,
  };
}

/** transformCard + validate in one step, returning the validation errors. */
function check(type: CardType, overrides: Record<string, string>) {
  return validate(type, transformCard(type, row(overrides)));
}

describe("build validation — governed vocabularies", () => {
  test("accepts a card with only governed values", () => {
    expect(check("locations", { attributes: "Commerce", location_type: "Market" })).toEqual([]);
    expect(check("events", { timing: "instant", event_type: "Catastrophe" })).toEqual([]);
    expect(check("items", { type: "Artifact" })).toEqual([]);
    expect(check("units", { attributes: "Military" })).toEqual([]);
  });

  test("rejects an un-governed attribute", () => {
    const errors = check("units", { attributes: "Millitary" });
    expect(errors.some((e) => e.field === "attributes" && e.message.includes("Millitary"))).toBe(true);
  });

  test("rejects an un-governed location_type", () => {
    const errors = check("locations", { location_type: "Bazaar" });
    expect(errors.some((e) => e.field === "location_type" && e.message.includes("Bazaar"))).toBe(true);
  });

  test("rejects an un-governed event_type", () => {
    const errors = check("events", { timing: "instant", event_type: "Blessing" });
    expect(errors.some((e) => e.field === "event_type" && e.message.includes("Blessing"))).toBe(true);
  });

  test("rejects an un-governed item type", () => {
    // "Accessory" is intentionally not in the governed set (pending #45).
    const errors = check("items", { type: "Accessory" });
    expect(errors.some((e) => e.field === "type" && e.message.includes("Accessory"))).toBe(true);
  });

  test("validation is case-sensitive on attributes (canonical CamelCase gate)", () => {
    const errors = check("units", { attributes: "military" });
    expect(errors.some((e) => e.field === "attributes")).toBe(true);
  });

  test("attributes are validated on every card type, not just units", () => {
    // #119 folded thematic keywords into `attributes` across all types.
    expect(check("policies", { attributes: "Nonsense" }).some((e) => e.field === "attributes")).toBe(true);
    expect(check("events", { timing: "instant", attributes: "Nonsense" }).some((e) => e.field === "attributes")).toBe(true);
  });
});

describe("build validation — governed keywords", () => {
  test("accepts governed keyword tokens on the right card type", () => {
    expect(check("units", { attributes: "Military", keywords: "Berserker;Leader:+1:all:combat" })).toEqual([]);
    expect(check("items", { type: "Banner", keywords: "Flying" })).toEqual([]);
    expect(check("locations", { location_type: "Market", keywords: "Aura:-1:all:combat" })).toEqual([]);
  });

  test("rejects an unknown keyword", () => {
    const errors = check("units", { attributes: "Military", keywords: "Lethal" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("unknown keyword"))).toBe(true);
  });

  test("rejects a malformed family token (unsigned magnitude)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Leader:1:all:combat" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("magnitude"))).toBe(true);
  });

  test("rejects an unsupported card type (Aura on a unit)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Aura:-1:all:combat" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("not supported on unit"))).toBe(true);
  });

  test("build/keywords.json emits the {name, cardTypes, params, reminder} shape the renderer reads", () => {
    // Pins the producer half of the render↔data contract: the Python renderer's
    // load_keyword_vocab expects a JSON array of {name, cardTypes, params,
    // reminder}, and compose_reminder binds a token's positional args to each
    // param `name`/`kind` before substituting into `reminder`. A rename or
    // reshape in build.ts's emit would break it silently — caught here. (Requires
    // a prior `bun library/build.ts`, which the `test` script runs first.)
    const artifact = JSON.parse(readFileSync(join(import.meta.dir, "../library/build/keywords.json"), "utf-8"));
    expect(Array.isArray(artifact)).toBe(true);
    expect(artifact.length).toBe(KEYWORDS.length);
    for (const entry of artifact) {
      expect(Object.keys(entry).sort()).toEqual(["cardTypes", "name", "params", "reminder"]);
      expect(typeof entry.name).toBe("string");
      expect(Array.isArray(entry.cardTypes)).toBe(true);
      expect(typeof entry.reminder).toBe("string");
      expect(Array.isArray(entry.params)).toBe(true);
      for (const p of entry.params) {
        expect(typeof p.name).toBe("string");
        expect(typeof p.kind).toBe("string");
      }
      // Every {paramName} placeholder in the template must bind to a declared param.
      const declared = new Set(entry.params.map((p: { name: string }) => p.name));
      for (const ph of entry.reminder.matchAll(/\{(\w+)\}/g)) {
        expect(declared.has(ph[1])).toBe(true);
      }
    }
  });
});

describe("build validation — cost is a numeric gold amount", () => {
  test("accepts an integer cost and `|`-separated integer alternatives", () => {
    expect(check("units", { cost: "3", attributes: "Military" })).toEqual([]);
    expect(check("units", { cost: "4|2", attributes: "Military" })).toEqual([]);
    expect(check("locations", { cost: "0", location_type: "Market" })).toEqual([]);
  });

  test("rejects a non-numeric cost", () => {
    const errors = check("units", { cost: "3g", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });

  test("rejects a blank cost", () => {
    const errors = check("units", { cost: "", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });

  test("rejects when any alternative-cost option is non-numeric", () => {
    const errors = check("units", { cost: "4|X", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });
});
