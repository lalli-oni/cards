import type { Grid, UnitCard } from "./types";

type Edge = "n" | "s" | "e" | "w";

/** Find a unit on the grid by instance ID. Returns its position or null. */
export function findUnitOnGrid(
  grid: Grid,
  unitId: string,
): { row: number; col: number; unit: UnitCard } | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const unit = grid[r][c].units.find((u) => u.id === unitId);
      if (unit) return { row: r, col: c, unit };
    }
  }
  return null;
}

/** True if the cell is on the grid perimeter (has at least one boundary edge). */
export function isPerimeterCell(
  gridRows: number,
  gridCols: number,
  row: number,
  col: number,
): boolean {
  return row === 0 || row === gridRows - 1 || col === 0 || col === gridCols - 1;
}

/** Return which edges of a cell face the grid boundary. */
export function getBoundaryEdges(
  row: number,
  col: number,
  gridRows: number,
  gridCols: number,
): Edge[] {
  const edges: Edge[] = [];
  if (row === 0) edges.push("n");
  if (row === gridRows - 1) edges.push("s");
  if (col === 0) edges.push("w");
  if (col === gridCols - 1) edges.push("e");
  return edges;
}

/** True if two cells are orthogonally adjacent (share an edge). */
export function isOrthogonallyAdjacent(
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const dr = Math.abs(r1 - r2);
  const dc = Math.abs(c1 - c2);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * Get the pair of facing edges between two adjacent cells.
 * E.g. moving from (0,0) to (1,0) means "from" faces south, "to" faces north.
 */
export function getFacingEdgePair(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): [fromEdge: Edge, toEdge: Edge] {
  if (toRow === fromRow - 1) return ["n", "s"];
  if (toRow === fromRow + 1) return ["s", "n"];
  if (toCol === fromCol - 1) return ["w", "e"];
  if (toCol === fromCol + 1) return ["e", "w"];
  throw new Error(
    `Cells (${fromRow},${fromCol}) and (${toRow},${toCol}) are not adjacent`,
  );
}

/**
 * Check if both facing edges are open between two adjacent cells.
 * Both cells must have locations. Returns false if either edge is blocked.
 */
export function areFacingEdgesOpen(
  grid: Grid,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): boolean {
  const fromLoc = grid[fromRow][fromCol].location;
  const toLoc = grid[toRow][toCol].location;
  if (!fromLoc || !toLoc) return false;

  const [fromEdge, toEdge] = getFacingEdgePair(fromRow, fromCol, toRow, toCol);
  return fromLoc.edges[fromEdge] && toLoc.edges[toEdge];
}

/** Get all valid orthogonal neighbor positions for a grid cell. */
export function getAdjacentCells(
  gridRows: number,
  gridCols: number,
  row: number,
  col: number,
): { row: number; col: number }[] {
  const neighbors: { row: number; col: number }[] = [];
  if (row > 0) neighbors.push({ row: row - 1, col });
  if (row < gridRows - 1) neighbors.push({ row: row + 1, col });
  if (col > 0) neighbors.push({ row, col: col - 1 });
  if (col < gridCols - 1) neighbors.push({ row, col: col + 1 });
  return neighbors;
}
