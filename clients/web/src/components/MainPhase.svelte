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

  <div
    class="min-h-0 flex-1"
    style="display: grid; grid-template-columns: 12rem 1fr 16rem; grid-template-rows: 1fr auto; gap: 0.75rem;"
  >
    <!-- Market (top-left) -->
    <div class="overflow-y-auto" style="grid-row: 1; grid-column: 1;">
      <MarketPanel
        cards={vs.market}
        {actions}
        onCardClick={handleCardClick}
      />
    </div>

    <!-- Grid (top-center, fills area) -->
    <div class="min-h-0" style="grid-row: 1; grid-column: 2;">
      <GridBoard
        grid={vs.grid}
        selfPlayerId={vs.self.id}
        {highlightedCells}
        onCellClick={handleCellClick}
      />
    </div>

    <!-- Right sidebar: Actions + Hand (spans both rows) -->
    <div class="flex flex-col gap-3 overflow-y-auto" style="grid-row: 1 / -1; grid-column: 3;">
      <ActionPanel {actions} />
      <HandPanel
        cards={vs.self.hand}
        {actions}
        onCardClick={handleCardClick}
      />
    </div>

    <!-- HQ (bottom, spans market + grid columns) -->
    <div class="overflow-x-auto" style="grid-row: 2; grid-column: 1 / 3;">
      <HqPanel
        cards={vs.self.hq}
        {actions}
        onCardClick={handleCardClick}
      />
    </div>
  </div>
</div>
