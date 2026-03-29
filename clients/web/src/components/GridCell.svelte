<script lang="ts">
  import type { GridCell, ItemCard } from "cards-engine";

  interface Props {
    cell: GridCell;
    row: number;
    col: number;
    selfPlayerId?: string;
    highlighted?: boolean;
    onclick?: (row: number, col: number) => void;
  }

  let { cell, row, col, selfPlayerId, highlighted = false, onclick }: Props = $props();

  const hasContent = $derived(
    cell.location !== null || cell.units.length > 0 || cell.items.length > 0,
  );

  const bgClass = $derived.by(() => {
    if (highlighted) return "bg-highlight-bg";
    if (hasContent) return "bg-surface-raised";
    return "bg-surface-sunken";
  });

  const edgeStyle = $derived.by(() => {
    if (!cell.location) return "border: 1px solid var(--color-cell-border)";
    const edges = cell.location.edges;
    const open = "1px dashed var(--color-cell-edge-open)";
    const blocked = "3px solid var(--color-cell-edge-blocked)";
    return [
      `border-top: ${edges.n ? open : blocked}`,
      `border-right: ${edges.e ? open : blocked}`,
      `border-bottom: ${edges.s ? open : blocked}`,
      `border-left: ${edges.w ? open : blocked}`,
    ].join("; ");
  });

  // Group equipped items by unit, separate loose items
  const equippedByUnit = $derived(
    cell.items.reduce(
      (map, item) => {
        if (item.equippedTo) {
          (map[item.equippedTo] ??= []).push(item);
        }
        return map;
      },
      {} as Record<string, ItemCard[]>,
    ),
  );
  const looseItems = $derived(cell.items.filter((i) => !i.equippedTo));
</script>

<button
  class="flex h-28 w-28 flex-col items-start justify-start overflow-hidden rounded p-1 text-2xs leading-tight transition-colors {bgClass}"
  style={highlighted ? `${edgeStyle}; outline: 2px solid var(--color-highlight-border)` : edgeStyle}
  onclick={() => onclick?.(row, col)}
  disabled={!onclick}
>
  {#if cell.location}
    <span class="w-full truncate font-semibold text-location" title={cell.location.name}>
      {cell.location.name}
    </span>
    {#if cell.location.requirements || cell.location.rewards}
      <span
        class="w-full truncate text-2xs text-text-muted"
        title="Req: {cell.location.requirements ?? 'none'} | Rew: {cell.location.rewards ?? 'none'}"
      >
        {#if cell.location.requirements}R:{cell.location.requirements.slice(0, 10)}{/if}
        {#if cell.location.rewards}{cell.location.requirements ? " " : ""}→{cell.location.rewards}{/if}
      </span>
    {/if}
  {/if}

  {#each cell.units as unit}
    <div
      class="flex w-full items-center gap-0.5 truncate {unit.ownerId === selfPlayerId
        ? 'text-self'
        : 'text-opponent'}"
      title="{unit.name} S:{unit.strength} C:{unit.cunning} Ch:{unit.charisma}{unit.injured
        ? ' INJURED'
        : ''}"
    >
      <span class="truncate font-semibold">{unit.name.slice(0, 7)}</span>
      <span class="text-2xs opacity-75">{unit.strength}/{unit.cunning}/{unit.charisma}</span>
      {#if unit.injured}<span class="text-danger">!</span>{/if}
    </div>
    {#if equippedByUnit[unit.id]}
      {#each equippedByUnit[unit.id] as item}
        <span class="w-full truncate pl-2 text-2xs text-item-equipped" title={item.name}>
          +{item.name.slice(0, 8)}
        </span>
      {/each}
    {/if}
  {/each}

  {#each looseItems as item}
    <span class="w-full truncate text-item" title={item.name}>
      ~{item.name.slice(0, 8)}
    </span>
  {/each}

  {#if !hasContent}
    <span class="m-auto text-text-faint">·</span>
  {/if}
</button>
