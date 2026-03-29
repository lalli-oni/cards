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

  const cellTooltip = $derived.by(() => {
    const lines: string[] = [];
    if (cell.location) {
      const e = cell.location.edges;
      const dir = (open: boolean) => (open ? "open" : "blocked");
      lines.push(`${cell.location.name}`);
      lines.push(`Edges: N:${dir(e.n)} E:${dir(e.e)} S:${dir(e.s)} W:${dir(e.w)}`);
      if (cell.location.requirements) lines.push(`Req: ${cell.location.requirements}`);
      if (cell.location.rewards) lines.push(`Rew: ${cell.location.rewards}`);
      if (cell.location.passive) lines.push(`Passive: ${cell.location.passive}`);
    }
    for (const u of cell.units) {
      const owner = u.ownerId === selfPlayerId ? "yours" : "opponent";
      const attrs = u.attributes.length > 0 ? ` [${u.attributes.join(", ")}]` : "";
      lines.push(`⚔️ ${u.name}${attrs} — S:${u.strength} C:${u.cunning} Ch:${u.charisma}${u.injured ? " INJURED" : ""} (${owner})`);
    }
    for (const i of cell.items) {
      lines.push(`🛡️ ${i.name}${i.equippedTo ? " (equipped)" : " (loose)"}`);
    }
    return lines.join("\n");
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
  class="flex min-h-24 min-w-24 flex-col items-start justify-start overflow-hidden rounded p-1 text-2xs leading-tight transition-colors {bgClass}"
  style={highlighted ? `${edgeStyle}; outline: 2px solid var(--color-highlight-border)` : edgeStyle}
  title={cellTooltip}
  onclick={() => onclick?.(row, col)}
  disabled={!onclick}
>
  {#if cell.location}
    <span class="w-full truncate font-semibold text-location">
      📍 {cell.location.name}
    </span>
    {#if cell.location.requirements || cell.location.rewards}
      <span class="w-full truncate text-2xs text-text-muted">
        {#if cell.location.requirements}R:{cell.location.requirements.slice(0, 10)}{/if}
        {#if cell.location.rewards}{cell.location.requirements ? " " : ""}→{cell.location.rewards}{/if}
      </span>
    {/if}
    {#if cell.location.passive}
      <span class="w-full truncate text-2xs text-passive">
        ✦ {cell.location.passive}
      </span>
    {/if}
  {/if}

  {#each cell.units as unit}
    <div
      class="flex w-full items-center gap-0.5 truncate {unit.ownerId === selfPlayerId
        ? 'text-self'
        : 'text-opponent'}"
    >
      <span class="truncate font-semibold">⚔️{unit.name.slice(0, 5)}</span>
      <span class="text-2xs"><span class="text-stat-strength">{unit.strength}</span>/<span class="text-stat-cunning">{unit.cunning}</span>/<span class="text-stat-charisma">{unit.charisma}</span></span>
      {#if unit.injured}<span class="text-danger">!</span>{/if}
      {#if unit.attributes.length > 0}
        <span class="text-2xs text-text-muted">{unit.attributes.join(", ")}</span>
      {/if}
    </div>
    {#if equippedByUnit[unit.id]}
      {#each equippedByUnit[unit.id] as eqItem}
        <span class="w-full truncate pl-2 text-2xs text-item-equipped" title="🛡️ {eqItem.name}{eqItem.equip ? ' — ' + eqItem.equip : ''}">
          ↳ {eqItem.name}{#if eqItem.equip}: {eqItem.equip}{/if}
        </span>
      {/each}
    {/if}
  {/each}

  {#each looseItems as looseItem}
    <span class="w-full truncate text-item" title="🛡️ {looseItem.name} (unequipped){looseItem.equip ? ' — ' + looseItem.equip : ''}">
      🛡️ {looseItem.name} (loose)
    </span>
  {/each}

  {#if !hasContent}
    <span class="m-auto text-text-faint">·</span>
  {/if}
</button>
