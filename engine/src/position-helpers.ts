import type { Grid, ItemCard, PlayerState, UnitCard } from "./types";

/**
 * A place on the board where units/items can be in play.
 * When #59 lands (HQ on grid), this collapses to just { row, col }.
 */
export type BoardPosition =
  | { type: "hq"; playerId: string }
  | { type: "grid"; row: number; col: number };

/** True if two positions refer to the same place. */
export function samePosition(a: BoardPosition, b: BoardPosition): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "hq" && b.type === "hq") return a.playerId === b.playerId;
  if (a.type === "grid" && b.type === "grid")
    return a.row === b.row && a.col === b.col;
  return false;
}

/** Find a unit's position — either in a player's HQ or on the grid. */
export function findUnitPosition(
  players: readonly { id: string; hq: readonly { id: string; type: string }[] }[],
  grid: Grid,
  unitId: string,
): { unit: UnitCard; position: BoardPosition } | null {
  for (const player of players) {
    const unit = player.hq.find((c) => c.id === unitId && c.type === "unit");
    if (unit) {
      return { unit: unit as UnitCard, position: { type: "hq", playerId: player.id } };
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const unit = grid[r][c].units.find((u) => u.id === unitId);
      if (unit) return { unit, position: { type: "grid", row: r, col: c } };
    }
  }
  return null;
}

/** Find an item's position — either in a player's HQ or on the grid. */
export function findItemPosition(
  players: readonly { id: string; hq: readonly { id: string; type: string }[] }[],
  grid: Grid,
  itemId: string,
): { item: ItemCard; position: BoardPosition } | null {
  for (const player of players) {
    const item = player.hq.find((c) => c.id === itemId && c.type === "item");
    if (item) {
      return { item: item as ItemCard, position: { type: "hq", playerId: player.id } };
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const item = grid[r][c].items.find((i) => i.id === itemId);
      if (item) return { item, position: { type: "grid", row: r, col: c } };
    }
  }
  return null;
}

/** Get all units at a position. */
export function getUnitsAtPosition(
  players: readonly PlayerState[],
  grid: Grid,
  position: BoardPosition,
): UnitCard[] {
  if (position.type === "hq") {
    const player = players.find((p) => p.id === position.playerId);
    if (!player) return [];
    return player.hq.filter((c) => c.type === "unit") as UnitCard[];
  }
  return grid[position.row]?.[position.col]?.units ?? [];
}

/** Get all items at a position. */
export function getItemsAtPosition(
  players: readonly PlayerState[],
  grid: Grid,
  position: BoardPosition,
): ItemCard[] {
  if (position.type === "hq") {
    const player = players.find((p) => p.id === position.playerId);
    if (!player) return [];
    return player.hq.filter((c) => c.type === "item") as ItemCard[];
  }
  return grid[position.row]?.[position.col]?.items ?? [];
}
