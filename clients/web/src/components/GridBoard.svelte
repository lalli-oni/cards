<script lang="ts">
  import type { Grid } from "cards-engine";
  import GridCell from "./GridCell.svelte";

  interface Props {
    grid: Grid;
    selfPlayerId?: string;
    highlightedCells?: Set<string>;
    onCellClick?: (row: number, col: number) => void;
  }

  let { grid, selfPlayerId, highlightedCells, onCellClick }: Props = $props();

  function cellKey(row: number, col: number): string {
    return `${row},${col}`;
  }
</script>

<div class="overflow-auto rounded-lg bg-stone-900 p-2">
  <div
    class="inline-grid gap-1"
    style="grid-template-columns: repeat({grid[0]?.length ?? 0}, auto)"
  >
    {#each grid as row, r}
      {#each row as cell, c}
        <GridCell
          {cell}
          row={r}
          col={c}
          {selfPlayerId}
          highlighted={highlightedCells?.has(cellKey(r, c)) ?? false}
          onclick={onCellClick}
        />
      {/each}
    {/each}
  </div>
</div>
