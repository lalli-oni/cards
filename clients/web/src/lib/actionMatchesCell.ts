import type { Action, Grid } from "cards-engine";

/**
 * True when `action` targets the cell at (row, col). Some actions carry an
 * instance id rather than coordinates, so they are resolved by looking the card
 * up on the visible grid: play_event by its target location, the item actions
 * by the item itself. An item in HQ matches no cell, which is correct — HQ is
 * off-grid.
 */
export function actionMatchesCell(
  action: Action,
  grid: Grid,
  row: number,
  col: number,
): boolean {
  if (action.type === "play_event" && action.targetId) {
    return grid[row]?.[col]?.location?.id === action.targetId;
  }
  if (action.type === "equip" || action.type === "unequip" || action.type === "transfer") {
    return grid[row]?.[col]?.items.some((i) => i.id === action.itemId) ?? false;
  }
  return (
    "row" in action &&
    "col" in action &&
    (action as { row: number }).row === row &&
    (action as { col: number }).col === col
  );
}
