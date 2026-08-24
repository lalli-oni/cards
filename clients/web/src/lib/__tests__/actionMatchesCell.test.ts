import { describe, expect, it } from "bun:test";
import type { Action, Grid, GridCell, LocationCard } from "cards-engine";
import { actionMatchesCell } from "../actionMatchesCell";

function makeLocation(id: string): LocationCard {
  return {
    id,
    definitionId: "test-location",
    type: "location",
    name: `Location ${id}`,
    cost: "0",
    rarity: "common",
    ownerId: "p1",
    controllerId: "p1",
    edges: { n: true, e: true, s: true, w: true },
  };
}

function emptyCell(): GridCell {
  return { location: null, units: [], items: [] };
}

function gridWith(locById: Record<string, [number, number]>): Grid {
  const grid: Grid = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => emptyCell()),
  );
  for (const [id, [r, c]] of Object.entries(locById)) {
    grid[r][c] = { ...emptyCell(), location: makeLocation(id) };
  }
  return grid;
}

describe("actionMatchesCell", () => {
  it("play_event with targetId matches only the cell whose location.id equals targetId", () => {
    const grid = gridWith({ "loc-a": [0, 1], "loc-b": [2, 2] });
    const action: Action = {
      type: "play_event",
      playerId: "p1",
      cardId: "trap-1",
      targetId: "loc-a",
    };

    expect(actionMatchesCell(action, grid, 0, 1)).toBe(true);
    expect(actionMatchesCell(action, grid, 2, 2)).toBe(false);
    expect(actionMatchesCell(action, grid, 0, 0)).toBe(false);
  });

  it("play_event with stale targetId (no matching location on grid) matches nothing", () => {
    const grid = gridWith({ "loc-a": [0, 1] });
    const action: Action = {
      type: "play_event",
      playerId: "p1",
      cardId: "trap-1",
      targetId: "loc-removed",
    };

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(actionMatchesCell(action, grid, r, c)).toBe(false);
      }
    }
  });

  it("play_event without targetId falls through and does not match any cell (no row/col on action)", () => {
    const grid = gridWith({ "loc-a": [0, 1] });
    const action: Action = {
      type: "play_event",
      playerId: "p1",
      cardId: "instant-1",
    };

    expect(actionMatchesCell(action, grid, 0, 1)).toBe(false);
    expect(actionMatchesCell(action, grid, 1, 1)).toBe(false);
  });

  it("enter action matches by row/col regardless of grid contents", () => {
    const grid = gridWith({});
    const action: Action = {
      type: "enter",
      playerId: "p1",
      unitId: "unit-1",
      row: 1,
      col: 2,
    };

    expect(actionMatchesCell(action, grid, 1, 2)).toBe(true);
    expect(actionMatchesCell(action, grid, 1, 1)).toBe(false);
    expect(actionMatchesCell(action, grid, 0, 2)).toBe(false);
  });

  it("attack action matches by row/col", () => {
    const grid = gridWith({});
    const action: Action = {
      type: "attack",
      playerId: "p1",
      unitIds: ["unit-1"],
      row: 2,
      col: 0,
    };

    expect(actionMatchesCell(action, grid, 2, 0)).toBe(true);
    expect(actionMatchesCell(action, grid, 0, 2)).toBe(false);
  });

  it("actions without row/col or targetId never match", () => {
    const grid = gridWith({ "loc-a": [0, 0] });
    const action: Action = { type: "pass", playerId: "p1" };

    expect(actionMatchesCell(action, grid, 0, 0)).toBe(false);
    expect(actionMatchesCell(action, grid, 1, 1)).toBe(false);
  });
});

describe("actionMatchesCell — item actions", () => {
  // equip/unequip/transfer identify their target by card instance id only, so
  // before this they matched no cell and the grid could never highlight them.
  // Resolved against the item's own cell, the same way play_event resolves
  // against its target location.

  /** A 3x3 grid with one item instance sitting at (row, col). */
  function gridWithItem(itemId: string, row: number, col: number): Grid {
    const grid: Grid = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => emptyCell()),
    );
    grid[row][col] = {
      ...emptyCell(),
      items: [{
        id: itemId,
        definitionId: "test-item",
        type: "item",
        name: "Test Item",
        cost: "1",
        rarity: "common",
        ownerId: "p1",
        controllerId: "p1",
      }],
    };
    return grid;
  }

  it("matches the cell holding the item", () => {
    const grid = gridWithItem("sword", 1, 2);

    expect(actionMatchesCell(
      { type: "unequip", playerId: "p1", itemId: "sword" }, grid, 1, 2,
    )).toBe(true);
    expect(actionMatchesCell(
      { type: "unequip", playerId: "p1", itemId: "sword" }, grid, 0, 0,
    )).toBe(false);
  });

  it("matches for equip and transfer too, keyed on the item rather than the unit", () => {
    const grid = gridWithItem("sword", 1, 2);

    expect(actionMatchesCell(
      { type: "equip", playerId: "p1", itemId: "sword", unitId: "u1" }, grid, 1, 2,
    )).toBe(true);
    expect(actionMatchesCell(
      { type: "transfer", playerId: "p1", itemId: "sword", unitId: "u2" }, grid, 1, 2,
    )).toBe(true);
  });

  it("matches no cell for an item in HQ", () => {
    // HQ is off-grid, so there is no cell to light up — the item is nowhere on
    // the grid and every lookup misses.
    const grid = gridWithItem("elsewhere", 0, 0);

    expect(actionMatchesCell(
      { type: "unequip", playerId: "p1", itemId: "sword" }, grid, 0, 0,
    )).toBe(false);
  });
});
