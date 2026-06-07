import { describe, expect, it } from "bun:test";
import type { Card, PickPrompt, UnitCard } from "cards-engine";
import { resolvePickOptions, togglePickSelection } from "../pickPrompt";

function makeUnit(id: string): UnitCard {
  return {
    id,
    definitionId: "test-unit",
    type: "unit",
    name: `Unit ${id}`,
    cost: "1",
    rarity: "common",
    strength: 1,
    cunning: 1,
    charisma: 1,
    attributes: [],
    injured: false,
    ownerId: "p1",
  };
}

function makePrompt(options: [string, ...string[]], count = 1): PickPrompt {
  return { kind: "deck_pick", playerId: "p1", options, count, source: "main_deck" };
}

describe("resolvePickOptions", () => {
  it("returns ok=true with all cards when every option is in mainDeck", () => {
    const deck: Card[] = [makeUnit("a"), makeUnit("b"), makeUnit("c")];
    const result = resolvePickOptions(makePrompt(["a", "c"]), deck);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.found.map((c: Card) => c.id)).toEqual(["a", "c"]);
  });

  it("preserves the option order from the prompt, not the deck order", () => {
    const deck: Card[] = [makeUnit("c"), makeUnit("a"), makeUnit("b")];
    const result = resolvePickOptions(makePrompt(["a", "b", "c"]), deck);
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.found.map((c: Card) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns ok=false with missing ids when some options aren't in mainDeck", () => {
    const deck: Card[] = [makeUnit("a")];
    const result = resolvePickOptions(makePrompt(["a", "b", "c"]), deck);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok=false");
    expect(result.missing).toEqual(["b", "c"]);
  });

  it("returns ok=false with all options missing when mainDeck is empty", () => {
    const result = resolvePickOptions(makePrompt(["a", "b"]), []);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok=false");
    expect(result.missing).toEqual(["a", "b"]);
  });

  it("narrows correctly under the discriminant — failure arm has no `found`", () => {
    const deck: Card[] = [makeUnit("a")];
    const result = resolvePickOptions(makePrompt(["a", "b"]), deck);
    if (result.ok) {
      // @ts-expect-error — `missing` is not on the ok=true arm
      result.missing;
    } else {
      // @ts-expect-error — `found` is not on the ok=false arm
      result.found;
    }
    expect(result.ok).toBe(false);
  });
});

describe("togglePickSelection", () => {
  it("adds a card when none are selected", () => {
    const next = togglePickSelection(new Set(), "a", 1);
    expect([...next]).toEqual(["a"]);
  });

  it("removes a card that's already selected", () => {
    const next = togglePickSelection(new Set(["a"]), "a", 1);
    expect([...next]).toEqual([]);
  });

  it("evicts the oldest selection FIFO when at the cap (count=1)", () => {
    const next = togglePickSelection(new Set(["a"]), "b", 1);
    expect([...next]).toEqual(["b"]);
  });

  it("evicts the oldest selection FIFO when at the cap (count=2)", () => {
    const next = togglePickSelection(new Set(["a", "b"]), "c", 2);
    expect([...next]).toEqual(["b", "c"]);
  });

  it("evicts the oldest selection FIFO when at the cap (count=3)", () => {
    const next = togglePickSelection(new Set(["a", "b", "c"]), "d", 3);
    expect([...next]).toEqual(["b", "c", "d"]);
  });

  it("does not evict when adding under the cap", () => {
    const next = togglePickSelection(new Set(["a"]), "b", 2);
    expect([...next]).toEqual(["a", "b"]);
  });

  it("removes without evicting when toggling an already-selected card at cap", () => {
    const next = togglePickSelection(new Set(["a", "b"]), "a", 2);
    expect([...next]).toEqual(["b"]);
  });

  it("returns a new Set instance (does not mutate single-entry input)", () => {
    const input = new Set(["a"]);
    const next = togglePickSelection(input, "b", 2);
    expect(input).not.toBe(next);
    expect([...input]).toEqual(["a"]);
  });

  it("does not mutate multi-entry input when an entry is FIFO-evicted in the output", () => {
    const input = new Set(["a", "b"]);
    const next = togglePickSelection(input, "c", 2);
    expect([...next]).toEqual(["b", "c"]);
    // `input` still has its original contents — eviction only affected the new Set
    expect([...input]).toEqual(["a", "b"]);
  });

  it("throws on count < 1", () => {
    expect(() => togglePickSelection(new Set(), "a", 0)).toThrow(RangeError);
    expect(() => togglePickSelection(new Set(), "a", -1)).toThrow(RangeError);
  });

  it("throws on non-integer count", () => {
    expect(() => togglePickSelection(new Set(), "a", 1.5)).toThrow(RangeError);
    expect(() => togglePickSelection(new Set(), "a", NaN)).toThrow(RangeError);
    expect(() => togglePickSelection(new Set(), "a", Infinity)).toThrow(RangeError);
  });

  it("eviction is FIFO by insertion order, not lexicographic", () => {
    const input = new Set<string>();
    input.add("zebra");
    input.add("apple");
    const next = togglePickSelection(input, "mango", 2);
    expect([...next]).toEqual(["apple", "mango"]);
  });
});
