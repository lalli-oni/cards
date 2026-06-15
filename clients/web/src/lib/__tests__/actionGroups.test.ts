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
