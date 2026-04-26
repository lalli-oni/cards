<script lang="ts">
  import type { Grid } from "cards-engine";
  import GridCell from "./GridCell.svelte";

  interface Props {
    grid: Grid;
    selfPlayerId?: string;
    highlightedCells?: Set<string>;
    selectedEntityId?: string | null;
    selectedCell?: { row: number; col: number } | null;
    onCellClick?: (row: number, col: number) => void;
    onUnitClick?: (unitId: string) => void;
  }

  let {
    grid,
    selfPlayerId,
    highlightedCells,
    selectedEntityId,
    selectedCell,
    onCellClick,
    onUnitClick,
  }: Props = $props();

  function cellKey(row: number, col: number): string {
    return `${row},${col}`;
  }

  function isCellSelected(row: number, col: number): boolean {
    return selectedCell?.row === row && selectedCell?.col === col;
  }
</script>

<div class="h-full overflow-auto rounded-lg bg-surface-sunken p-2">
  <div
    class="grid h-full gap-1"
    style="grid-template-columns: repeat({grid[0]?.length ?? 0}, 1fr); grid-template-rows: repeat({grid.length}, 1fr)"
  >
    {#each grid as row, r}
      {#each row as cell, c}
        <GridCell
          {cell}
          row={r}
          col={c}
          {selfPlayerId}
          highlighted={highlightedCells?.has(cellKey(r, c)) ?? false}
          selected={isCellSelected(r, c)}
          {selectedEntityId}
          onclick={onCellClick}
          {onUnitClick}
        />
      {/each}
    {/each}
  </div>
</div>
