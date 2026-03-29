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

  // Edge border styles: open = thin dashed, blocked = thick solid red
  const edgeStyle = $derived.by(() => {
    if (!cell.location) return "border: 1px solid #44403c"; // stone-700
    const e = cell.location.edges;
    const open = "1px dashed #57534e"; // stone-600
    const blocked = "3px solid #7f1d1d"; // red-900
    return [
      `border-top: ${e.n ? open : blocked}`,
      `border-right: ${e.e ? open : blocked}`,
      `border-bottom: ${e.s ? open : blocked}`,
      `border-left: ${e.w ? open : blocked}`,
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
  class="flex h-28 w-28 flex-col items-start justify-start overflow-hidden rounded p-1 text-[11px] leading-tight transition-colors
    {highlighted
    ? 'bg-amber-900/30'
    : hasContent
      ? 'bg-stone-700'
      : 'bg-stone-800'}"
  style={highlighted ? `${edgeStyle}; outline: 2px solid #f59e0b` : edgeStyle}
  onclick={() => onclick?.(row, col)}
  disabled={!onclick}
>
  {#if cell.location}
    <span class="w-full truncate font-semibold text-blue-300" title={cell.location.name}>
      {cell.location.name}
    </span>
    {#if cell.location.requirements || cell.location.rewards}
      <span
        class="w-full truncate text-[10px] text-stone-400"
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
        ? 'text-emerald-300'
        : 'text-rose-300'}"
      title="{unit.name} S:{unit.strength} C:{unit.cunning} Ch:{unit.charisma}{unit.injured
        ? ' INJURED'
        : ''}"
    >
      <span class="truncate font-semibold">{unit.name.slice(0, 7)}</span>
      <span class="text-[10px] opacity-75">{unit.strength}/{unit.cunning}/{unit.charisma}</span>
      {#if unit.injured}<span class="text-red-400">!</span>{/if}
    </div>
    {#if equippedByUnit[unit.id]}
      {#each equippedByUnit[unit.id] as item}
        <span class="w-full truncate pl-2 text-[10px] text-yellow-400" title={item.name}>
          +{item.name.slice(0, 8)}
        </span>
      {/each}
    {/if}
  {/each}

  {#each looseItems as item}
    <span class="w-full truncate text-yellow-300" title={item.name}>
      ~{item.name.slice(0, 8)}
    </span>
  {/each}

  {#if !hasContent}
    <span class="m-auto text-stone-600">·</span>
  {/if}
</button>
