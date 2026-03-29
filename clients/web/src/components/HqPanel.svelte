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
        .filter((a) => "unitId" in a || "cardId" in a)
        .map((a) => {
          if ("unitId" in a) return (a as { unitId: string }).unitId;
          return (a as { cardId: string }).cardId;
        }),
    ),
  );
</script>

<CardListPanel title="HQ" {cards} highlightedIds={actionableCardIds} {onCardClick} />
