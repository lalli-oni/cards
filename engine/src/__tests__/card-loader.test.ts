import { describe, test, expect, beforeEach } from "bun:test";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import {
  loadCardDefinitions,
  loadCardDefinitionsFromBuild,
  instantiateCard,
  instantiateCards,
  resetInstanceCounter,
  CardValidationError,
} from "../card-loader";
import type { CardDefinition } from "../card-loader";

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
  keywords: ["Fighter"],
  strength: 5,
  cunning: 3,
  charisma: 2,
  attributes: ["Warrior"],
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
  keywords: [],
  mission: "control>3",
  passive: "gain_gold_1",
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
  keywords: [],
  equip: "strength_plus_2",
  stored: null,
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
  keywords: [],
  subtype: "trap",
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
  keywords: [],
  effect: "all_players_pay_1",
};

beforeEach(() => {
  resetInstanceCounter();
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

  test("throws CardValidationError on invalid card data", () => {
    const path = writeTmpJson("bad.json", [
      { id: "ok", name: "OK", set: "s", type: "unit", rarity: "common" },
      { id: "bad", name: "Bad", set: "s", type: "INVALID", rarity: "common" },
    ]);
    expect(() => loadCardDefinitions(path)).toThrow(CardValidationError);
  });

  test("validates event subtype", () => {
    const badEvent = { ...VALID_EVENT, subtype: "wrong" };
    const path = writeTmpJson("bad-event.json", [badEvent]);
    try {
      loadCardDefinitions(path);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(CardValidationError);
      expect((e as CardValidationError).errors[0].message).toContain("invalid event subtype");
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
      expect((e as CardValidationError).errors[0].message).toContain("policy missing effect");
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
});

// ---------------------------------------------------------------------------
// instantiateCard
// ---------------------------------------------------------------------------

describe("instantiateCard", () => {
  test("creates unit card with unique instance ID", () => {
    const card = instantiateCard(VALID_UNIT, "player-1");
    expect(card.type).toBe("unit");
    expect(card.id).toBe("test-warrior-1");
    expect(card.definitionId).toBe("test-warrior");
    expect(card.ownerId).toBe("player-1");
    expect(card.name).toBe("Test Warrior");
    expect(card.cost).toBe("3");
    expect(card.rarity).toBe("common");
    expect(card.text).toBe("A test unit.");
    expect(card.keywords).toEqual(["Fighter"]);

    // Unit-specific
    if (card.type === "unit") {
      expect(card.strength).toBe(5);
      expect(card.cunning).toBe(3);
      expect(card.charisma).toBe(2);
      expect(card.attributes).toEqual(["Warrior"]);
      expect(card.injured).toBe(false);
    }
  });

  test("creates location card with default open edges", () => {
    const card = instantiateCard(VALID_LOCATION, "player-1");
    expect(card.type).toBe("location");
    if (card.type === "location") {
      expect(card.edges).toEqual({ n: true, e: true, s: true, w: true });
      expect(card.mission).toBe("control>3");
      expect(card.passive).toBe("gain_gold_1");
    }
  });

  test("creates item card", () => {
    const card = instantiateCard(VALID_ITEM, "player-1");
    expect(card.type).toBe("item");
    if (card.type === "item") {
      expect(card.equip).toBe("strength_plus_2");
      expect(card.stored).toBeUndefined();
      expect(card.equippedTo).toBeUndefined();
    }
  });

  test("creates event card", () => {
    const card = instantiateCard(VALID_EVENT, "player-1");
    expect(card.type).toBe("event");
    if (card.type === "event") {
      expect(card.subtype).toBe("trap");
      expect(card.trigger).toBe("unit_enters");
    }
  });

  test("creates policy card", () => {
    const card = instantiateCard(VALID_POLICY, "player-1");
    expect(card.type).toBe("policy");
    if (card.type === "policy") {
      expect(card.effect).toBe("all_players_pay_1");
    }
  });

  test("normalizes array cost to pipe-separated string", () => {
    const def = { ...VALID_UNIT, cost: ["3", "5"] };
    const card = instantiateCard(def, "player-1");
    expect(card.cost).toBe("3|5");
  });

  test("generates incrementing unique instance IDs", () => {
    const card1 = instantiateCard(VALID_UNIT, "p1");
    const card2 = instantiateCard(VALID_UNIT, "p1");
    const card3 = instantiateCard(VALID_LOCATION, "p2");
    expect(card1.id).toBe("test-warrior-1");
    expect(card2.id).toBe("test-warrior-2");
    expect(card3.id).toBe("test-castle-3");
  });
});

// ---------------------------------------------------------------------------
// instantiateCards
// ---------------------------------------------------------------------------

describe("instantiateCards", () => {
  test("instantiates all definitions for an owner", () => {
    const defs = [VALID_UNIT, VALID_LOCATION, VALID_ITEM, VALID_EVENT, VALID_POLICY];
    const cards = instantiateCards(defs, "player-1");
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => c.ownerId === "player-1")).toBe(true);
    expect(new Set(cards.map((c) => c.id)).size).toBe(5);
  });

  test("returns empty array for empty definitions", () => {
    expect(instantiateCards([], "p1")).toEqual([]);
  });
});
