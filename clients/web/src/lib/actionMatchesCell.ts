import type { Action, Grid } from "cards-engine";

/**
 * True when `action` targets the cell at (row, col). play_event actions carry
 * the target location's instance id rather than coordinates, so resolve them
 * by looking up the cell's location on the visible grid.
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
  return (
    "row" in action &&
    "col" in action &&
    (action as { row: number }).row === row &&
    (action as { col: number }).col === col
  );
}
