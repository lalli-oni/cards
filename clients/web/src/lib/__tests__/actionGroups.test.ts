import { describe, expect, it } from "bun:test";
import type { Action } from "cards-engine";
import { describeAction } from "../actionGroups";

const cardName = (id: string) => `card:${id}`;
const cellName = (row: number, col: number) => `cell-${row}-${col}`;

describe("describeAction — activate", () => {
  function activate(overrides: Partial<Extract<Action, { type: "activate" }>> = {}): Extract<Action, { type: "activate" }> {
    return {
      type: "activate",
      playerId: "p1",
      cardId: "marco-polo",
      actionName: "trade-route",
      ...overrides,
    };
  }

  it("plain activate (no target) — name + action only", () => {
    expect(describeAction(activate(), cardName, cellName)).toBe(
      "Activate card:marco-polo: trade-route",
    );
  });

  it("activate with targetCell — appends ' → <cell>' so move(self) variants are distinguishable", () => {
    const label = describeAction(
      activate({ targetCell: { row: 0, col: 1 } }),
      cardName,
      cellName,
    );
    expect(label).toBe("Activate card:marco-polo: trade-route → cell-0-1 (0,1)");
  });

  it("activate with targetId — appends ' → <unit>' for multi-target contests", () => {
    const label = describeAction(
      activate({ cardId: "hannibal-barca", actionName: "flank", targetId: "spartacus-1" }),
      cardName,
      cellName,
    );
    expect(label).toBe("Activate card:hannibal-barca: flank → card:spartacus-1");
  });

  it("activate prefers targetCell over targetId when both are present", () => {
    // If a future verb resolves both, the cell anchor is more informative
    // (units move/die; cells don't).
    const label = describeAction(
      activate({ targetCell: { row: 2, col: 0 }, targetId: "some-unit" }),
      cardName,
      cellName,
    );
    expect(label).toBe("Activate card:marco-polo: trade-route → cell-2-0 (2,0)");
  });

  it("activate without resolvers falls back to raw ids and bare coords", () => {
    const label = describeAction(activate({ targetCell: { row: 1, col: 1 } }));
    expect(label).toBe("Activate marco-polo: trade-route → (1,1)");
  });
});

describe("describeAction — item actions", () => {
  // The three item actions split out of a single `equip` (#270). equip and
  // transfer name their target unit; unequip does not, so its label leans on
  // the bearer resolver to stay distinguishable.

  it("names the target unit for equip and transfer", () => {
    const n = (id: string) => (id === "sword" ? "Excalibur" : id === "u1" ? "Arthur" : id);

    expect(describeAction({ type: "equip", playerId: "p1", itemId: "sword", unitId: "u1" }, n))
      .toBe("Equip Excalibur on Arthur");
    expect(describeAction({ type: "transfer", playerId: "p1", itemId: "sword", unitId: "u1" }, n))
      .toBe("Transfer Excalibur to Arthur");
  });

  it("appends the bearer to unequip so two co-located bearers stay distinguishable", () => {
    const n = (id: string) => (id === "sword" ? "Excalibur" : id === "u1" ? "Arthur" : id);
    const bearer = (itemId: string) => (itemId === "sword" ? "Arthur" : null);

    expect(describeAction({ type: "unequip", playerId: "p1", itemId: "sword" }, n, undefined, bearer))
      .toBe("Unequip Excalibur from Arthur");
  });

  it("omits the bearer clause when no resolver is supplied", () => {
    expect(describeAction({ type: "unequip", playerId: "p1", itemId: "sword" }))
      .toBe("Unequip sword");
  });
});
