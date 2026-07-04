import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CardDefinition, InstanceCounter } from "../card-loader";
import {
  CardValidationError,
  createInstanceCounter,
  instantiateCard,
  instantiateCards,
  loadCardDefinitions,
  loadCardDefinitionsFromBuild,
} from "../card-loader";
import { ATTRIBUTES, isAttribute } from "../attributes";

const TMP_DIR = join(import.meta.dir, "__tmp_card_loader__");

function writeTmpJson(filename: string, data: unknown): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, filename);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

const VALID_UNIT: CardDefinition = {
  id: "test-warrior",
  name: "Test Warrior",
  set: "test-set",
  type: "unit",
  rarity: "common",
  cost: "3",
  text: "A test unit.",
  flavor: null,
  abilities: ["Fighter"],
  strength: 5,
  cunning: 3,
  charisma: 2,
  attributes: ["Military"],
};

const VALID_LOCATION: CardDefinition = {
  id: "test-castle",
  name: "Test Castle",
  set: "test-set",
  type: "location",
  rarity: "rare",
  cost: "4",
  text: null,
  flavor: null,
  abilities: [],
  mission: "control>3",
  requirements: "units_3",
  rewards: "3vp",
  passive: "gain_gold_1",
  location_type: "Sanctuary",
};

const VALID_ITEM: CardDefinition = {
  id: "test-sword",
  name: "Test Sword",
  set: "test-set",
  type: "item",
  rarity: "uncommon",
  cost: "2",
  text: "+2 Strength",
  flavor: null,
  abilities: [],
  equip: "strength_plus_2",
  stored: null,
  itemType: ["Weapon"],
};

const VALID_EVENT: CardDefinition = {
  id: "test-ambush",
  name: "Test Ambush",
  set: "test-set",
  type: "event",
  rarity: "common",
  cost: "1",
  text: null,
  flavor: null,
  abilities: [],
  timing: "trap",
  trigger: "unit_enters",
  duration: null,
};

const VALID_POLICY: CardDefinition = {
  id: "test-tax",
  name: "Test Tax",
  set: "test-set",
  type: "policy",
  rarity: "uncommon",
  cost: "0",
  text: null,
  flavor: null,
  abilities: [],
  effect: "all_players_pay_1",
};

let counter: InstanceCounter;

beforeEach(() => {
  counter = createInstanceCounter();
  try {
    rmSync(TMP_DIR, { recursive: true });
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw e;
    }
  }
});

afterAll(() => {
  try {
    rmSync(TMP_DIR, { recursive: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// loadCardDefinitions
// ---------------------------------------------------------------------------

describe("loadCardDefinitions", () => {
  test("loads valid card definitions from JSON", () => {
    const path = writeTmpJson("valid.json", [VALID_UNIT, VALID_LOCATION]);
    const defs = loadCardDefinitions(path);
    expect(defs).toHaveLength(2);
    expect(defs[0].id).toBe("test-warrior");
    expect(defs[1].id).toBe("test-castle");
  });

  test("throws on missing file", () => {
    expect(() => loadCardDefinitions("/nonexistent/path.json")).toThrow(
      "Card definitions file not found",
    );
  });

  test("throws on invalid JSON structure", () => {
    const path = writeTmpJson("obj.json", { not: "an array" });
    expect(() => loadCardDefinitions(path)).toThrow("Expected JSON array");
  });

  test("includes file path in JSON parse error", () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const path = join(TMP_DIR, "broken.json");
    writeFileSync(path, "{not valid json");
    expect(() => loadCardDefinitions(path)).toThrow("Failed to parse");
    expect(() => loadCardDefinitions(path)).toThrow("broken.json");
  });

  test("throws CardValidationError on invalid card data", () => {
    const path = writeTmpJson("bad.json", [
      { id: "ok", name: "OK", set: "s", type: "unit", rarity: "common" },
      { id: "bad", name: "Bad", set: "s", type: "INVALID", rarity: "common" },
    ]);
    expect(() => loadCardDefinitions(path)).toThrow(CardValidationError);
  });

  test("detects duplicate card IDs", () => {
    const path = writeTmpJson("dup.json", [VALID_UNIT, VALID_UNIT]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect(
        (e as CardValidationError).errors.some((err) =>
          err.message.includes("duplicate"),
        ),
      ).toBe(true);
    }
  });

  test("validates event timing", () => {
    const badEvent = { ...VALID_EVENT, timing: "wrong" };
    const path = writeTmpJson("bad-event.json", [badEvent]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect((e as CardValidationError).errors[0].message).toContain(
        "invalid event timing",
      );
    }
  });

  test("validates policy effect", () => {
    const badPolicy = { ...VALID_POLICY, effect: "" };
    const path = writeTmpJson("bad-policy.json", [badPolicy]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect((e as CardValidationError).errors[0].message).toContain(
        "policy missing effect",
      );
    }
  });

  test("validates unit numeric stats", () => {
    const badUnit = { ...VALID_UNIT, strength: null, cunning: "five" };
    const path = writeTmpJson("bad-unit.json", [badUnit]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      const messages = (e as CardValidationError).errors.map(
        (err) => err.message,
      );
      expect(messages.some((m) => m.includes("strength"))).toBe(true);
      expect(messages.some((m) => m.includes("cunning"))).toBe(true);
    }
  });

  test("validates cost field", () => {
    const noCost = { ...VALID_UNIT, cost: undefined };
    const path = writeTmpJson("no-cost.json", [noCost]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect(
        (e as CardValidationError).errors.some((err) =>
          err.message.includes("cost"),
        ),
      ).toBe(true);
    }
  });

  test("validates abilities field", () => {
    const badAbilities = { ...VALID_UNIT, abilities: "not-an-array" };
    const path = writeTmpJson("bad-abilities.json", [badAbilities]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect(
        (e as CardValidationError).errors.some((err) =>
          err.message.includes("abilities"),
        ),
      ).toBe(true);
    }
  });

  test("rejects non-array attributes", () => {
    const badAttributes = { ...VALID_UNIT, attributes: "Military" };
    const path = writeTmpJson("bad-attributes.json", [badAttributes]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect(
        (e as CardValidationError).errors.some((err) =>
          err.message.includes("attributes"),
        ),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// loadCardDefinitionsFromBuild
// ---------------------------------------------------------------------------

describe("loadCardDefinitionsFromBuild", () => {
  test("loads all.json when no sets specified", () => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeTmpJson("all.json", [VALID_UNIT]);
    const defs = loadCardDefinitionsFromBuild(TMP_DIR);
    expect(defs).toHaveLength(1);
  });

  test("loads specific sets", () => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeTmpJson("set-a.json", [VALID_UNIT]);
    writeTmpJson("set-b.json", [VALID_LOCATION]);
    const defs = loadCardDefinitionsFromBuild(TMP_DIR, ["set-a", "set-b"]);
    expect(defs).toHaveLength(2);
  });

  test("throws on missing build directory", () => {
    expect(() => loadCardDefinitionsFromBuild("/nonexistent")).toThrow(
      "Build directory not found",
    );
  });
});

// ---------------------------------------------------------------------------
// loadCardDefinitions with real library build
// ---------------------------------------------------------------------------

describe("loadCardDefinitions with real library", () => {
  const LIBRARY_BUILD = join(import.meta.dir, "../../../library/build");

  test("loads alpha-1 set from actual build output", () => {
    const defs = loadCardDefinitions(join(LIBRARY_BUILD, "alpha-1.json"));
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.set).toBe("alpha-1");
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
    }
  });

  // Guards the vocabulary migration (#158): every attribute value in the
  // real CSV data must be one of the governed domain-nouns, spelled in the
  // exact CamelCase the effect factories (`effects.ts`) match against. A
  // casing/typo/un-migrated value in the CSV would otherwise silently
  // no-op the effect with no other test failing.
  test("every unit attribute in the loaded library is a governed attribute", () => {
    const defs = loadCardDefinitions(join(LIBRARY_BUILD, "alpha-1.json"));
    const units = defs.filter((d) => d.type === "unit");
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      const attrs = (unit as { attributes?: string[] }).attributes ?? [];
      for (const attr of attrs) {
        expect(isAttribute(attr)).toBe(true);
        // Exact CamelCase — not just case-insensitively valid.
        expect(ATTRIBUTES as readonly string[]).toContain(attr);
      }
    }
  });

  // `Engineering` and `Commerce` have no effect/mission consumer, so this
  // is the ONLY test that would fail if their rename were reverted or
  // mistyped in the CSV (see PR #162 review, finding 6).
  test("Engineering and Commerce carriers are present and correctly spelled", () => {
    const defs = loadCardDefinitions(join(LIBRARY_BUILD, "alpha-1.json"));
    const attrsOf = (id: string): string[] =>
      (defs.find((d) => d.id === id) as { attributes?: string[] } | undefined)
        ?.attributes ?? [];
    expect(attrsOf("nikola-tesla")).toContain("Engineering");
    expect(attrsOf("leonardo-da-vinci")).toContain("Engineering");
    expect(attrsOf("marco-polo")).toContain("Commerce");
  });

  // Pins individual CSV values that are otherwise only verified via test
  // helpers using explicit duration overrides (so a CSV regression would
  // not fail any of the integration suites).
  test("Plague passive has duration 2 in the loaded library", () => {
    const defs = loadCardDefinitions(join(LIBRARY_BUILD, "alpha-1.json"));
    const plague = defs.find((d) => d.id === "plague");
    expect(plague).toBeDefined();
    expect(plague?.timing).toBe("passive");
    expect((plague as { duration?: number }).duration).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// instantiateCard
// ---------------------------------------------------------------------------

describe("instantiateCard", () => {
  test("creates unit card with sequential instance ID", () => {
    const card = instantiateCard(VALID_UNIT, "player-1", counter);
    expect(card.type).toBe("unit");
    expect(card.id).toBe("1");
    expect(card.definitionId).toBe("test-warrior");
    expect(card.ownerId).toBe("player-1");
    expect(card.name).toBe("Test Warrior");
    expect(card.cost).toBe("3");
    expect(card.rarity).toBe("common");
    expect(card.text).toBe("A test unit.");
    expect(card.abilities).toEqual(["Fighter"]);

    // Unit-specific
    expect((card as any).strength).toBe(5);
    expect((card as any).cunning).toBe(3);
    expect((card as any).charisma).toBe(2);
    expect((card as any).attributes).toEqual(["Military"]);
    expect((card as any).injured).toBe(false);
  });

  test("creates location card with default open edges", () => {
    const card = instantiateCard(VALID_LOCATION, "player-1", counter);
    expect(card.type).toBe("location");
    if (card.type === "location") {
      expect(card.edges).toEqual({ n: true, e: true, s: true, w: true });
      expect(card.requirements).toBe("units_3");
      expect(card.rewards).toBe("3vp");
      expect(card.passive).toBe("gain_gold_1");
      expect(card.location_type).toBe("Sanctuary");
    }
  });

  test("creates item card", () => {
    const card = instantiateCard(VALID_ITEM, "player-1", counter);
    expect(card.type).toBe("item");
    if (card.type === "item") {
      expect(card.equip).toBe("strength_plus_2");
      expect(card.stored).toBeUndefined();
      expect(card.equippedTo).toBeUndefined();
      expect(card.itemType).toEqual(["Weapon"]);
    }
  });

  test("creates event card", () => {
    const card = instantiateCard(VALID_EVENT, "player-1", counter);
    expect(card.type).toBe("event");
    if (card.type === "event") {
      expect(card.timing).toBe("trap");
      if (card.timing === "trap") {
        expect(card.trigger).toBe("unit_enters");
      }
    }
  });

  test("creates policy card", () => {
    const card = instantiateCard(VALID_POLICY, "player-1", counter);
    expect(card.type).toBe("policy");
    if (card.type === "policy") {
      expect(card.effect).toBe("all_players_pay_1");
    }
  });

  test("normalizes array cost to pipe-separated string", () => {
    const def = { ...VALID_UNIT, cost: ["3", "5"] };
    const card = instantiateCard(def, "player-1", counter);
    expect(card.cost).toBe("3|5");
  });

  test("generates incrementing sequential IDs", () => {
    const card1 = instantiateCard(VALID_UNIT, "p1", counter);
    const card2 = instantiateCard(VALID_UNIT, "p1", counter);
    const card3 = instantiateCard(VALID_LOCATION, "p2", counter);
    expect(card1.id).toBe("1");
    expect(card2.id).toBe("2");
    expect(card3.id).toBe("3");
  });

  test("separate counters produce independent ID sequences", () => {
    const counter2 = createInstanceCounter();
    const cardA = instantiateCard(VALID_UNIT, "p1", counter);
    const cardB = instantiateCard(VALID_UNIT, "p2", counter2);
    expect(cardA.id).toBe("1");
    expect(cardB.id).toBe("1");
  });

  test("throws when event card missing timing", () => {
    const badEvent = { ...VALID_EVENT, timing: undefined } as CardDefinition;
    expect(() => instantiateCard(badEvent, "p1", counter)).toThrow(
      "missing required timing",
    );
  });

  test("throws when policy card missing effect", () => {
    const badPolicy = { ...VALID_POLICY, effect: undefined } as CardDefinition;
    expect(() => instantiateCard(badPolicy, "p1", counter)).toThrow(
      "missing required effect",
    );
  });
});

// ---------------------------------------------------------------------------
// instantiateCards
// ---------------------------------------------------------------------------

describe("instantiateCards", () => {
  test("instantiates all definitions for an owner", () => {
    const defs = [
      VALID_UNIT,
      VALID_LOCATION,
      VALID_ITEM,
      VALID_EVENT,
      VALID_POLICY,
    ];
    const cards = instantiateCards(defs, "player-1", counter);
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => c.ownerId === "player-1")).toBe(true);
    expect(new Set(cards.map((c) => c.id)).size).toBe(5);
  });

  test("returns empty array for empty definitions", () => {
    expect(instantiateCards([], "p1", counter)).toEqual([]);
  });
});
