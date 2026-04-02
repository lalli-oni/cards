<script lang="ts">
  import type { Action, Card } from "cards-engine";
  import CardListPanel from "./CardListPanel.svelte";

  interface Props {
    cards: Card[];
    actions: Action[];
    onCardClick?: (card: Card) => void;
  }

  let { cards, actions, onCardClick }: Props = $props();

  const actionableCardIds = $derived(
    new Set(
      actions
        .filter((a) => "cardId" in a)
        .map((a) => (a as { cardId: string }).cardId),
    ),
  );
</script>

<CardListPanel title="Hand" {cards} highlightedIds={actionableCardIds} {onCardClick} />
