<script lang="ts">
  import type { Card } from "cards-engine";
  import CardView from "./CardView.svelte";

  interface Props {
    title: string;
    cards: Card[];
    highlightedIds?: Set<string>;
    highlighted?: boolean;
    onCardClick?: (card: Card) => void;
    onAreaClick?: () => void;
  }

  let { title, cards, highlightedIds, highlighted = false, onCardClick, onAreaClick }: Props = $props();
</script>

{#snippet cardList()}
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
{/snippet}

{#if onAreaClick}
  <div
    class="rounded-lg p-3 transition-colors cursor-pointer
      {highlighted
      ? 'bg-[var(--color-target-bg)] outline outline-2 outline-[var(--color-target-border)]'
      : 'bg-surface'}"
    role="button"
    tabindex="0"
    onclick={onAreaClick}
    onkeydown={(e) => { if (e.key === "Enter") onAreaClick?.(); }}
  >
    {@render cardList()}
  </div>
{:else}
  <div class="rounded-lg bg-surface p-3">
    {@render cardList()}
  </div>
{/if}
