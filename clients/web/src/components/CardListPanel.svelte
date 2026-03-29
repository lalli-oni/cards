<script lang="ts">
  import type { Card } from "cards-engine";
  import CardView from "./CardView.svelte";

  interface Props {
    title: string;
    cards: Card[];
    highlightedIds?: Set<string>;
    onCardClick?: (card: Card) => void;
  }

  let { title, cards, highlightedIds, onCardClick }: Props = $props();
</script>

<div class="rounded-lg bg-surface p-3">
  <h3 class="mb-2 text-sm font-semibold text-text-muted">{title} ({cards.length})</h3>
  <div class="flex gap-2 overflow-x-auto pb-1">
    {#each cards as card}
      <CardView
        {card}
        highlighted={highlightedIds?.has(card.id) ?? false}
        onclick={onCardClick}
      />
    {/each}
    {#if cards.length === 0}
      <span class="text-sm text-text-faint italic">Empty</span>
    {/if}
  </div>
</div>
