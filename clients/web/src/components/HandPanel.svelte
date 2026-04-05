<script lang="ts">
  import type { Action, Card } from "cards-engine";
  import CardListPanel from "./CardListPanel.svelte";

  interface Props {
    cards: Card[];
    actions: Action[];
    hasSelection?: boolean;
    onCardClick?: (card: Card) => void;
  }

  let { cards, actions, hasSelection = false, onCardClick }: Props = $props();

  const actionableCardIds = $derived(
    new Set(
      actions
        .filter((a) => {
          if (!("cardId" in a)) return false;
          // Without a selection, only highlight cards with meaningful actions (not destroy)
          if (!hasSelection && a.type === "destroy") return false;
          return true;
        })
        .map((a) => (a as { cardId: string }).cardId),
    ),
  );
</script>

<CardListPanel title="Hand" {cards} highlightedIds={actionableCardIds} {onCardClick} />
