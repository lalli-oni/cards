<script lang="ts">
  import type { Action, Card } from "cards-engine";
  import CardListPanel from "./CardListPanel.svelte";

  interface Props {
    cards: Card[];
    actions: Action[];
    onCardClick?: (card: Card) => void;
  }

  let { cards, actions, onCardClick }: Props = $props();

  const buyableCardIds = $derived(
    new Set(
      actions
        .filter((a) => a.type === "buy")
        .map((a) => (a as { cardId: string }).cardId),
    ),
  );
</script>

<CardListPanel title="Market" {cards} highlightedIds={buyableCardIds} {onCardClick} />
