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

// Synthetic `rules/README.md` fixtures — exercise parseGlossary's logic and its
// throw guards independently of the live rules content (#203).
function keywordSystem(body: string): string {
  return `# Rules\n\n## Keyword System\n\n### Keyword Glossary\n${body}\n\n## Economy\n`;
}

const UNIT_TABLE: string = [
  "#### Unit keywords",
  "| Keyword | Timing | Definition |",
  "|---------|--------|------------|",
  "| Commander | Static | Friendly units get +X to all stats |",
  "| Lethal | Static | The loser is killed instead of injured |",
  "| Heal | Activated (1 AP) | Remove the injured status |",
].join("\n");
const EQUIP_TABLE: string = [
  "#### Equipment keywords",
  "| Keyword | Timing | Definition |",
  "|---------|--------|------------|",
  "| Flying | Static | Ignores blocked edges |",
].join("\n");
const LOCATION_TABLE: string = [
  "#### Location keywords",
  "| Keyword | Timing | Definition |",
  "|---------|--------|------------|",
  "| Radiated | Static | Units get -X to all stats |",
].join("\n");
// A minimal well-formed section covering all three required scopes.
const FULL: string = `\n${UNIT_TABLE}\n\n${EQUIP_TABLE}\n\n${LOCATION_TABLE}\n`;

describe("keyword glossary — parseGlossary (synthetic + throw guards)", () => {
  test("parses a well-formed synthetic section", () => {
    const g = parseGlossary(keywordSystem(FULL));
    expect(g.commander).toMatchObject({ scope: "unit", timing: "static", valued: true });
    expect(g.heal).toMatchObject({ timing: "activated", apCost: 1 });
    expect(g.flying.scope).toBe("equipment");
    expect(g.radiated.scope).toBe("location");
  });

  test("throws when the `## Keyword System` section is missing", () => {
    expect(() => parseGlossary("# Rules\n\nNothing here.\n")).toThrow(/Keyword System/);
  });

  test("throws on an unrecognized timing", () => {
    const bad = FULL.replace("| Lethal | Static |", "| Lethal | Bogus |");
    expect(() => parseGlossary(keywordSystem(bad))).toThrow(/unrecognized timing/);
  });

  test("throws when no keywords parse (heading present, no rows)", () => {
    const empty = "\n#### Unit keywords\n| Keyword | Timing | Definition |\n|---|---|---|\n";
    expect(() => parseGlossary(keywordSystem(empty))).toThrow(/no keywords parsed/);
  });

  test("throws when a whole scope's heading is renamed (partial corruption)", () => {
    const renamed = FULL.replace("#### Location keywords", "#### Location Keywords (core)");
    expect(() => parseGlossary(keywordSystem(renamed))).toThrow(/no 'location' keywords/);
  });

  test("throws on a duplicate keyword", () => {
    const dup = FULL.replace(
      "| Lethal | Static | The loser is killed instead of injured |",
      "| Lethal | Static | The loser is killed instead of injured |\n| Commander | Static | Duplicate |",
    );
    expect(() => parseGlossary(keywordSystem(dup))).toThrow(/duplicate keyword/);
  });

  test("throws on a content-bearing malformed row", () => {
    const short = FULL.replace(
      "| Lethal | Static | The loser is killed instead of injured |",
      "| Lonely |",
    );
    expect(() => parseGlossary(keywordSystem(short))).toThrow(/malformed table row/);
  });

  test("throws when AP cost and timing disagree", () => {
    const apStatic = FULL.replace("| Commander | Static |", "| Commander | Static (2 AP) |");
    expect(() => parseGlossary(keywordSystem(apStatic))).toThrow(/AP cost but timing/);
    const noAp = FULL.replace("| Heal | Activated (1 AP) |", "| Heal | Activated |");
    expect(() => parseGlossary(keywordSystem(noAp))).toThrow(/missing its "\(N AP\)"/);
  });

  test("infers valued from a standalone X, not an X inside a word", () => {
    const body = FULL.replace(
      "| Lethal | Static | The loser is killed instead of injured |",
      "| Boost | Static | Gain +X power |\n| Taxman | Static | Costs MAX gold |",
    );
    const g = parseGlossary(keywordSystem(body));
    expect(g.boost.valued).toBe(true); // standalone +X
    expect(g.taxman.valued).toBe(false); // X only inside MAX
  });

  test("tolerates a missing trailing pipe and markdown alignment separators", () => {
    const body = [
      "",
      "#### Unit keywords",
      "| Keyword | Timing | Definition |",
      "|:--------|:------:|--------:|", // alignment colons
      "| NoTrail | Static | Works without a trailing pipe", // no trailing |
      "",
      EQUIP_TABLE,
      "",
      LOCATION_TABLE,
    ].join("\n");
    const g = parseGlossary(keywordSystem(body));
    expect(g.notrail).toMatchObject({ scope: "unit", timing: "static" });
  });
});

describe("keyword glossary — parseGlossary", () => {
  test("parses timing, scope, and apCost", () => {
    expect(GLOSSARY.commander).toMatchObject({ name: "Commander", scope: "unit", timing: "static" });
    expect(GLOSSARY.commander.apCost).toBeUndefined();
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

  test("keeps the definition verbatim as the reminder (incl. its X)", () => {
    const g = parseGlossary(keywordSystem(FULL));
    expect(g.commander.reminder).toBe("Friendly units get +X to all stats");
  });

  test("skips header/separator rows and parses all 13 live keywords", () => {
    expect(GLOSSARY.keyword).toBeUndefined();
    expect(Object.keys(GLOSSARY).length).toBe(13);
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

  test("trims surrounding whitespace and parses multi-digit values", () => {
    expect(parseAbilityToken(" Commander[10] ")).toEqual({ id: "commander", name: "Commander", value: 10 });
  });

  test("allows a hyphenated ident", () => {
    expect(parseAbilityToken("Some-Word")).toEqual({ id: "some-word", name: "Some-Word", value: null });
  });

  test("parses [0] at the token level (arity/positivity is validate()'s call)", () => {
    expect(parseAbilityToken("Commander[0]")).toEqual({ id: "commander", name: "Commander", value: 0 });
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

  test("rejects a mis-cased keyword (Title-case must match the glossary)", () => {
    expect(checkAbilities("commander[3]").some((e) => e.message.includes('must be written "Commander"'))).toBe(true);
  });

  test("rejects a zero magnitude on a valued keyword", () => {
    expect(checkAbilities("Commander[0]").some((e) => e.message.includes("positive magnitude"))).toBe(true);
  });

  test("reports each token independently in a multi-keyword field", () => {
    // One malformed + one valid → exactly the malformed one flagged.
    const mixed = checkAbilities("Bogus{x};Commander[3]");
    expect(mixed).toHaveLength(1);
    expect(mixed[0].message).toContain("malformed");
    // Two distinct arity errors in one field both surface.
    const both = checkAbilities("Commander;Lethal[2]");
    expect(both.some((e) => e.message.includes("requires a value"))).toBe(true);
    expect(both.some((e) => e.message.includes("does not take a value"))).toBe(true);
  });

  test("skips ability validation when no glossary is supplied", () => {
    // The 2-arg form (used elsewhere) must not touch abilities.
    expect(validate("units", transformCard("units", row({ abilities: "Commander" })))
      .some((e) => e.field === "abilities")).toBe(false);
  });
});
