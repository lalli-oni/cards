<script lang="ts">
  import type { Card } from "cards-engine";

  interface Props {
    card: Card;
    highlighted?: boolean;
    onclick?: (card: Card) => void;
  }

  let { card, highlighted = false, onclick }: Props = $props();

  function statLine(c: Card): string {
    if (c.type === "unit") {
      return `${c.strength}/${c.cunning}/${c.charisma}${c.injured ? " 🩹" : ""}`;
    }
    if (c.type === "location") {
      return c.requirements ?? "";
    }
    return "";
  }

  const typeLabel: Record<string, string> = {
    unit: "U",
    location: "L",
    item: "I",
    event: "E",
    policy: "P",
  };
</script>

<button
  class="w-32 flex-shrink-0 rounded border p-2 text-left text-xs transition-colors
    {highlighted
    ? 'border-highlight-border bg-highlight-bg'
    : 'border-surface-hover bg-surface-raised hover:border-text-faint'}"
  onclick={() => onclick?.(card)}
  disabled={!onclick}
>
  <div class="mb-1 flex items-center justify-between">
    <span class="truncate font-semibold text-text-primary">{card.name}</span>
    <span class="ml-1 text-text-muted">{card.cost}</span>
  </div>
  <div class="flex items-center justify-between text-text-muted">
    <span class="rounded bg-surface-hover px-1">{typeLabel[card.type]}</span>
    <span>{statLine(card)}</span>
  </div>
  {#if card.text}
    <div class="mt-1 truncate text-text-faint">{card.text}</div>
  {/if}
</button>
