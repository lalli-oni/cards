<script lang="ts">
  import type { Action, Card, VisibleState } from "cards-engine";
  import { selectAction } from "../lib/gameStore.svelte";
  import PlayerHud from "./PlayerHud.svelte";
  import GridBoard from "./GridBoard.svelte";
  import HandPanel from "./HandPanel.svelte";
  import MarketPanel from "./MarketPanel.svelte";
  import HqPanel from "./HqPanel.svelte";
  import ActionPanel from "./ActionPanel.svelte";

  interface Props {
    vs: VisibleState;
    actions: Action[];
  }

  let { vs, actions }: Props = $props();

  // Cells targeted by any action (for grid highlighting)
  const highlightedCells = $derived(
    new Set(
      actions
        .filter((a) => "row" in a && "col" in a)
        .map((a) => `${(a as { row: number }).row},${(a as { col: number }).col}`),
    ),
  );

  function handleCardClick(card: Card) {
    // Find the first action that references this card and select it
    const match = actions.find(
      (a) =>
        ("cardId" in a && (a as { cardId: string }).cardId === card.id) ||
        ("unitId" in a && (a as { unitId: string }).unitId === card.id) ||
        ("itemId" in a && (a as { itemId: string }).itemId === card.id),
    );
    if (match) {
      selectAction(match);
    }
  }

  function handleCellClick(row: number, col: number) {
    const match = actions.find(
      (a) =>
        "row" in a &&
        "col" in a &&
        (a as { row: number }).row === row &&
        (a as { col: number }).col === col,
    );
    if (match) {
      selectAction(match);
    }
  }
</script>

<div class="flex h-full flex-col gap-3">
  <PlayerHud {vs} />

  <div class="flex min-h-0 flex-1 gap-3">
    <!-- Main area: grid + hand -->
    <div class="flex flex-1 flex-col gap-3 overflow-hidden">
      <div class="flex-1 overflow-auto">
        <GridBoard
          grid={vs.grid}
          {highlightedCells}
          onCellClick={handleCellClick}
        />
      </div>
      <HandPanel
        cards={vs.self.hand}
        {actions}
        onCardClick={handleCardClick}
      />
      <div class="flex gap-3">
        <div class="flex-1">
          <MarketPanel
            cards={vs.market}
            {actions}
            onCardClick={handleCardClick}
          />
        </div>
        <div class="flex-1">
          <HqPanel
            cards={vs.self.hq}
            {actions}
            onCardClick={handleCardClick}
          />
        </div>
      </div>
    </div>

    <!-- Sidebar: actions -->
    <div class="w-64 flex-shrink-0">
      <ActionPanel {actions} />
    </div>
  </div>
</div>
