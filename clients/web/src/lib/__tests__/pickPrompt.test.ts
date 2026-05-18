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

function makePrompt(options: string[], count = 1): PickPrompt {
  return { playerId: "p1", options, count, source: "main_deck" };
}

describe("resolvePickOptions", () => {
  it("returns empty resolution when prompt is undefined", () => {
    const result = resolvePickOptions(undefined, [makeUnit("a")]);
    expect(result).toEqual({ cards: [], missingIds: [] });
  });

  it("resolves every option id when all are present", () => {
    const deck: Card[] = [makeUnit("a"), makeUnit("b"), makeUnit("c")];
    const result = resolvePickOptions(makePrompt(["a", "c"]), deck);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(result.missingIds).toEqual([]);
  });

  it("preserves the option order from the prompt, not the deck order", () => {
    const deck: Card[] = [makeUnit("c"), makeUnit("a"), makeUnit("b")];
    const result = resolvePickOptions(makePrompt(["a", "b", "c"]), deck);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("reports missing ids separately when some options aren't in mainDeck", () => {
    const deck: Card[] = [makeUnit("a")];
    const result = resolvePickOptions(makePrompt(["a", "b", "c"]), deck);
    expect(result.cards.map((c) => c.id)).toEqual(["a"]);
    expect(result.missingIds).toEqual(["b", "c"]);
  });

  it("returns all missing when mainDeck is empty", () => {
    const result = resolvePickOptions(makePrompt(["a", "b"]), []);
    expect(result.cards).toEqual([]);
    expect(result.missingIds).toEqual(["a", "b"]);
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

  it("does not evict when adding under the cap", () => {
    const next = togglePickSelection(new Set(["a"]), "b", 2);
    expect([...next]).toEqual(["a", "b"]);
  });

  it("removes without evicting when toggling an already-selected card at cap", () => {
    const next = togglePickSelection(new Set(["a", "b"]), "a", 2);
    expect([...next]).toEqual(["b"]);
  });

  it("returns a new Set instance (does not mutate input)", () => {
    const input = new Set(["a"]);
    const next = togglePickSelection(input, "b", 2);
    expect(input).not.toBe(next);
    expect([...input]).toEqual(["a"]);
  });
});
