import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  transformCard,
  validate,
  type CardType,
} from "../library/build";
import { parseGlossary, parseAbilityToken } from "../library/glossary";

const GLOSSARY = parseGlossary(readFileSync(join(import.meta.dir, "../rules/README.md"), "utf-8"));

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
    abilities: "",
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

// ---------------------------------------------------------------------------
// Keyword glossary — the render↔data contract (#203)
//
// `parseGlossary` derives the machine-readable glossary from rules/README.md;
// `validate` uses it to check ability value-syntax. These pin the derivation
// (a rules refactor that breaks the tables fails here) and the render-accuracy
// checks — while confirming governance of *unknown* keywords stays deferred.
// ---------------------------------------------------------------------------

describe("keyword glossary — parseGlossary", () => {
  test("parses timing, scope, and apCost", () => {
    expect(GLOSSARY.commander).toMatchObject({ name: "Commander", scope: "unit", timing: "static" });
    expect(GLOSSARY.heal).toMatchObject({ timing: "activated", apCost: 1 });
    expect(GLOSSARY.flying.scope).toBe("equipment");
    expect(GLOSSARY.radiated.scope).toBe("location");
  });

  test("infers valued-ness from an X placeholder in the definition", () => {
    // Only the +X / -X keywords take a value.
    expect(GLOSSARY.commander.valued).toBe(true);
    expect(GLOSSARY.radiated.valued).toBe(true);
    expect(GLOSSARY.fortified.valued).toBe(true);
    expect(GLOSSARY.lethal.valued).toBe(false);
    expect(GLOSSARY.taunt.valued).toBe(false);
  });

  test("keeps the X placeholder in the reminder template", () => {
    expect(GLOSSARY.commander.reminder).toContain("+X");
  });
});

describe("parseAbilityToken", () => {
  test("parses value-less and valued tokens", () => {
    expect(parseAbilityToken("Lethal")).toEqual({ id: "lethal", name: "Lethal", value: null });
    expect(parseAbilityToken("Commander[3]")).toEqual({ id: "commander", name: "Commander", value: 3 });
  });

  test("returns null on malformed tokens", () => {
    expect(parseAbilityToken("Bogus{x}")).toBeNull();
    expect(parseAbilityToken("Commander(3)")).toBeNull();
  });
});

describe("build validation — ability value syntax (#203)", () => {
  /** transformCard + validate WITH the glossary, returning ability errors. */
  function checkAbilities(abilities: string) {
    return validate("units", transformCard("units", row({ abilities })), GLOSSARY)
      .filter((e) => e.field === "abilities");
  }

  test("accepts correct arity", () => {
    expect(checkAbilities("Commander[3];Lethal")).toEqual([]);
  });

  test("rejects a valued keyword with no value", () => {
    expect(checkAbilities("Commander").some((e) => e.message.includes("requires a value"))).toBe(true);
  });

  test("rejects a value-less keyword given a value", () => {
    expect(checkAbilities("Lethal[2]").some((e) => e.message.includes("does not take a value"))).toBe(true);
  });

  test("rejects a malformed token", () => {
    expect(checkAbilities("Bogus{x}").some((e) => e.message.includes("malformed"))).toBe(true);
  });

  test("allows an unknown keyword (governance deferred to #194)", () => {
    expect(checkAbilities("Mystery")).toEqual([]);
  });

  test("skips ability validation when no glossary is supplied", () => {
    // The 2-arg form (used elsewhere) must not touch abilities.
    expect(validate("units", transformCard("units", row({ abilities: "Commander" })))
      .some((e) => e.field === "abilities")).toBe(false);
  });
});
