<script lang="ts">
  import type { Action, Card } from "cards-engine";
  import CardListPanel from "./CardListPanel.svelte";

  interface Props {
    cards: Card[];
    actions: Action[];
    hasSelection?: boolean;
    highlighted?: boolean;
    onCardClick?: (card: Card) => void;
    onAreaClick?: () => void;
  }

  let { cards, actions, hasSelection = false, highlighted = false, onCardClick, onAreaClick }: Props = $props();

  const actionableCardIds: Set<string> = $derived(
    new Set(
      actions
        .filter((a) => "unitId" in a || "cardId" in a || "itemId" in a)
        .map((a) => {
          if ("unitId" in a) return (a as { unitId: string }).unitId;
          if ("itemId" in a) return (a as { itemId: string }).itemId;
          return (a as { cardId: string }).cardId;
        }),
    ),
  );
</script>

<CardListPanel title="HQ" {cards} highlightedIds={actionableCardIds} {highlighted} {onCardClick} {onAreaClick} />
