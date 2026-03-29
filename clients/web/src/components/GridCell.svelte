<script lang="ts">
  import type { GridCell } from "cards-engine";

  interface Props {
    cell: GridCell;
    row: number;
    col: number;
    highlighted?: boolean;
    onclick?: (row: number, col: number) => void;
  }

  let { cell, row, col, highlighted = false, onclick }: Props = $props();

  const hasContent = $derived(
    cell.location !== null || cell.units.length > 0 || cell.items.length > 0,
  );
</script>

<button
  class="flex h-20 w-20 flex-col items-center justify-center rounded border p-1 text-xs transition-colors
    {highlighted
    ? 'border-amber-400 bg-amber-900/30'
    : hasContent
      ? 'border-stone-500 bg-stone-700'
      : 'border-stone-700 bg-stone-800'}"
  onclick={() => onclick?.(row, col)}
  disabled={!onclick}
>
  {#if cell.location}
    <span class="truncate font-semibold text-blue-300" title={cell.location.name}>
      {cell.location.name}
    </span>
  {/if}
  {#each cell.units as unit}
    <span
      class="truncate text-green-300"
      title="{unit.name} ({unit.ownerId}) {unit.strength}/{unit.cunning}/{unit.charisma}{unit.injured ? ' injured' : ''}"
    >
      {unit.name.slice(0, 8)}{unit.injured ? "!" : ""}
    </span>
  {/each}
  {#each cell.items as item}
    <span class="truncate text-yellow-300" title={item.name}>
      {item.name.slice(0, 8)}
    </span>
  {/each}
  {#if !hasContent}
    <span class="text-stone-600">·</span>
  {/if}
</button>
