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
  <div class="flex flex-wrap gap-2">
    {#each cards as card}
      <CardView
        {card}
        highlighted={highlightedIds?.has(card.id) ?? false}
        onclick={onCardClick}
      />
    {/each}
  </div>
</div>
