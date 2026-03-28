import type { Draft } from "immer";
import type { EmitFn } from "./listeners/types";
import type { ItemCard, MainGameState, UnitCard } from "./types";
import { getPlayerById } from "./state-helpers";

/** Kill a unit: remove from grid cell, drop items, send to owner's discard. */
export function killUnit(
  draft: Draft<MainGameState>,
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  dropEquippedItems(cell, unit, row, col, emit);
  const idx = cell.units.findIndex((u) => u.id === unit.id);
  if (idx !== -1) {
    cell.units.splice(idx, 1);
  }
  const owner = getPlayerById(draft, unit.ownerId);
  owner.discardPile.push(unit);
  emit({ type: "unit_killed", unitId: unit.id, ownerId: unit.ownerId });
}

/** Injure a unit: set injured flag, drop equipped items. */
export function injureUnit(
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  unit.injured = true;
  dropEquippedItems(cell, unit, row, col, emit);
  emit({ type: "unit_injured", unitId: unit.id, ownerId: unit.ownerId });
}

/** Drop all items equipped to a unit at the unit's location. */
export function dropEquippedItems(
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  for (const item of cell.items) {
    if (item.equippedTo === unit.id) {
      item.equippedTo = undefined;
      emit({ type: "item_dropped", itemId: item.id, row, col });
    }
  }
}
