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

  // ---------------------------------------------------------------------------
  // Selection state
  // ---------------------------------------------------------------------------

  let selectedEntityId = $state<string | null>(null);
  let selectedCell = $state<{ row: number; col: number } | null>(null);

  function clearSelection() {
    selectedEntityId = null;
    selectedCell = null;
  }

  // Clear selection when the action list changes (new turn or after action executes)
  $effect(() => {
    // Referencing actions registers the dependency; the body just clears selection.
    void actions;
    clearSelection();
  });

  const hasSelection = $derived(selectedEntityId !== null || selectedCell !== null);

  // ---------------------------------------------------------------------------
  // Filtered actions & highlighting
  // ---------------------------------------------------------------------------

  function actionReferencesEntity(a: Action, id: string): boolean {
    return (
      ("unitId" in a && (a as { unitId: string }).unitId === id) ||
      ("cardId" in a && (a as { cardId: string }).cardId === id) ||
      ("itemId" in a && (a as { itemId: string }).itemId === id) ||
      (a.type === "attack" && a.unitIds.includes(id))
    );
  }

  function actionMatchesCell(a: Action, row: number, col: number): boolean {
    // Location-targeting event cards (Highway Robbery, Ambush, Assassination
    // Attempt, Plague — see engine valid-actions.ts needsLocationTarget) carry
    // the target location's instance id rather than row/col, so match by
    // looking up the location on the visible grid (issue #124).
    if (a.type === "play_event" && a.targetId) {
      return vs.grid[row]?.[col]?.location?.id === a.targetId;
    }
    return (
      "row" in a &&
      "col" in a &&
      (a as { row: number }).row === row &&
      (a as { col: number }).col === col
    );
  }

  const filteredActions = $derived.by(() => {
    if (selectedEntityId) {
      const id = selectedEntityId;
      return actions.filter((a) => actionReferencesEntity(a, id));
    }
    if (selectedCell) {
      const { row, col } = selectedCell;
      return actions.filter((a) => actionMatchesCell(a, row, col));
    }
    return actions;
  });

  // Only highlight target cells when something is selected. Iterates the grid
  // and asks actionMatchesCell so play_event actions (which target by location
  // instance id rather than row/col) light up the right cell.
  const highlightedCells = $derived.by<Set<string>>(() => {
    if (!hasSelection) return new Set<string>();
    const result = new Set<string>();
    for (let r = 0; r < vs.grid.length; r++) {
      for (let c = 0; c < vs.grid[r].length; c++) {
        if (filteredActions.some((a) => actionMatchesCell(a, r, c))) {
          result.add(`${r},${c}`);
        }
      }
    }
    return result;
  });

  // HQ highlights as deploy target when a deployable hand card is selected
  const hqDeployAction: Action | undefined = $derived(
    hasSelection ? filteredActions.find((a) => a.type === "deploy") : undefined,
  );

  function handleHqClick() {
    if (hqDeployAction) {
      selectAction(hqDeployAction);
      clearSelection();
    }
  }

  // ---------------------------------------------------------------------------
  // Click handlers
  // ---------------------------------------------------------------------------

  function handleUnitClick(unitId: string) {
    if (selectedEntityId === unitId) {
      clearSelection();
      return;
    }
    const hasActions = actions.some((a) => actionReferencesEntity(a, unitId));
    if (hasActions) {
      clearSelection();
      selectedEntityId = unitId;
    } else {
      clearSelection();
    }
  }

  function handleCardClick(card: Card) {
    // If entity selected and this card is a valid target (e.g. equip)
    if (selectedEntityId) {
      const match = filteredActions.find((a) =>
        ("unitId" in a && (a as { unitId: string }).unitId === card.id) ||
        ("cardId" in a && (a as { cardId: string }).cardId === card.id) ||
        ("itemId" in a && (a as { itemId: string }).itemId === card.id),
      );
      if (match && card.id !== selectedEntityId) {
        selectAction(match);
        clearSelection();
        return;
      }
    }

    // Toggle if clicking the same card
    if (selectedEntityId === card.id) {
      clearSelection();
      return;
    }

    // Select this card as source
    const hasActions = actions.some((a) => actionReferencesEntity(a, card.id));
    if (hasActions) {
      clearSelection();
      selectedEntityId = card.id;
    } else {
      clearSelection();
    }
  }

  function handleCellClick(row: number, col: number) {
    // If entity selected, try to execute an action targeting this cell
    if (selectedEntityId) {
      const match = filteredActions.find((a) => actionMatchesCell(a, row, col));
      if (match) {
        selectAction(match);
        clearSelection();
        return;
      }
    }

    // Toggle if clicking the same cell
    if (selectedCell?.row === row && selectedCell?.col === col) {
      clearSelection();
      return;
    }

    // Select this cell as source
    const hasActions: boolean = actions.some((a) => actionMatchesCell(a, row, col));
    if (hasActions) {
      clearSelection();
      selectedCell = { row, col };
    } else {
      clearSelection();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && hasSelection) {
      clearSelection();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

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
        actions={filteredActions}
        onCardClick={handleCardClick}
      />
    </div>

    <!-- Grid (top-center, fills area) -->
    <div class="min-h-0" style="grid-row: 1; grid-column: 2;">
      <GridBoard
        grid={vs.grid}
        selfPlayerId={vs.self.id}
        {highlightedCells}
        {selectedEntityId}
        {selectedCell}
        onCellClick={handleCellClick}
        onUnitClick={handleUnitClick}
      />
    </div>

    <!-- Right sidebar: Actions + Hand (spans both rows) -->
    <div class="flex flex-col gap-3 overflow-y-auto" style="grid-row: 1 / -1; grid-column: 3;">
      <ActionPanel
        actions={filteredActions}
        onDeselect={hasSelection ? clearSelection : undefined}
      />
      <HandPanel
        cards={vs.self.hand}
        actions={filteredActions}
        {hasSelection}
        onCardClick={handleCardClick}
      />
    </div>

    <!-- HQ (bottom, spans market + grid columns) -->
    <div class="overflow-x-auto" style="grid-row: 2; grid-column: 1 / 3;">
      <HqPanel
        cards={vs.self.hq}
        actions={filteredActions}
        {hasSelection}
        highlighted={!!hqDeployAction}
        onCardClick={handleCardClick}
        onAreaClick={hqDeployAction ? handleHqClick : undefined}
      />
    </div>
  </div>
</div>
