<script lang="ts">
  import type { Action, Card } from "cards-engine";
  import CardView from "./CardView.svelte";

  interface Props {
    cards: Card[];
    actions: Action[];
    onCardClick?: (card: Card) => void;
  }

  let { cards, actions, onCardClick }: Props = $props();

  const actionableCardIds = $derived(
    new Set(
      actions
        .filter((a) => "unitId" in a || "cardId" in a)
        .map((a) => {
          if ("unitId" in a) return (a as { unitId: string }).unitId;
          return (a as { cardId: string }).cardId;
        }),
    ),
  );
</script>

<div class="rounded-lg bg-stone-800 p-3">
  <h3 class="mb-2 text-sm font-semibold text-stone-400">HQ ({cards.length})</h3>
  <div class="flex gap-2 overflow-x-auto pb-1">
    {#each cards as card}
      <CardView
        {card}
        highlighted={actionableCardIds.has(card.id)}
        onclick={onCardClick}
      />
    {/each}
    {#if cards.length === 0}
      <span class="text-sm text-stone-500 italic">Empty</span>
    {/if}
  </div>
</div>
