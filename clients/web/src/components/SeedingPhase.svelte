<script lang="ts">
  import type { Action, Card, VisibleState } from "cards-engine";
  import { selectAction } from "../lib/gameStore.svelte";
  import CardView from "./CardView.svelte";
  import GridBoard from "./GridBoard.svelte";
  import PlayerHud from "./PlayerHud.svelte";

  interface Props {
    vs: VisibleState;
    actions: Action[];
  }

  let { vs, actions }: Props = $props();

  // seed_keep state: track which cards to keep vs expose
  let keepSet = $state(new Set<string>());

  const step = $derived(vs.seedingStep);
  const config = $derived(vs.config);
  const keepCount = $derived(Number(config.seed_keep) || 8);
  const exposeCount = $derived(Number(config.seed_expose) || 2);

  function handleSimpleAction() {
    if (actions.length > 0) {
      selectAction(actions[0]);
    }
  }

  function toggleKeep(cardId: string) {
    const next = new Set(keepSet);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else if (next.size < keepCount) {
      next.add(cardId);
    }
    keepSet = next;
  }

  function submitKeep() {
    const hand = vs.self.hand;
    const keepIds = hand.filter((c) => keepSet.has(c.id)).map((c) => c.id);
    const exposeIds = hand.filter((c) => !keepSet.has(c.id)).map((c) => c.id);

    // Manually constructed — engine returns a template with empty arrays.
    // Validation tracked in #76.
    selectAction({
      type: "seed_keep",
      playerId: vs.currentPlayerId,
      keepIds,
      exposeIds,
    });
    keepSet = new Set();
  }

  function handleSteal(card: Card) {
    const match = actions.find(
      (a) => a.type === "seed_steal" && "cardId" in a && a.cardId === card.id,
    );
    if (match) {
      selectAction(match);
    }
  }

  function handlePlaceLocation(row: number, col: number) {
    const match = actions.find(
      (a) =>
        a.type === "seed_place_location" &&
        "row" in a &&
        a.row === row &&
        "col" in a &&
        a.col === col,
    );
    if (match) {
      selectAction(match);
    }
  }

  // Cells valid for placement
  const placementCells = $derived(
    new Set(
      actions
        .filter((a) => "row" in a && "col" in a)
        .map((a) => `${(a as { row: number }).row},${(a as { col: number }).col}`),
    ),
  );
</script>

<div class="flex h-full flex-col gap-3">
  <PlayerHud {vs} />

  <div class="rounded-lg bg-stone-800 p-4">
    <h2 class="mb-3 text-lg font-semibold text-stone-200">
      Seeding — {step?.replace(/_/g, " ") ?? ""}
    </h2>

    {#if step === "seed_draw"}
      <button
        onclick={handleSimpleAction}
        class="rounded bg-amber-600 px-6 py-2 font-semibold text-white hover:bg-amber-500"
      >
        Draw Seeding Cards
      </button>

    {:else if step === "seed_keep"}
      <p class="mb-3 text-sm text-stone-400">
        Select {keepCount} cards to keep ({keepSet.size}/{keepCount}).
        Remaining {exposeCount} will be exposed.
      </p>
      <div class="mb-4 flex flex-wrap gap-2">
        {#each vs.self.hand as card}
          <div class="relative">
            <CardView
              {card}
              highlighted={keepSet.has(card.id)}
              onclick={() => toggleKeep(card.id)}
            />
            {#if keepSet.has(card.id)}
              <span class="absolute -top-1 -right-1 rounded-full bg-amber-500 px-1.5 text-xs font-bold text-black">
                K
              </span>
            {/if}
          </div>
        {/each}
      </div>
      <button
        onclick={submitKeep}
        disabled={keepSet.size !== keepCount}
        class="rounded bg-amber-600 px-6 py-2 font-semibold text-white hover:bg-amber-500
          disabled:cursor-not-allowed disabled:opacity-50"
      >
        Confirm ({keepSet.size}/{keepCount} kept)
      </button>

    {:else if step === "seed_steal"}
      <p class="mb-3 text-sm text-stone-400">Select a card to steal from the middle.</p>
      <div class="flex flex-wrap gap-2">
        {#each vs.middleArea as card}
          <CardView {card} highlighted={true} onclick={handleSteal} />
        {/each}
      </div>

    {:else if step === "seed_place_location"}
      <p class="mb-3 text-sm text-stone-400">Click a cell to place the location.</p>
      <GridBoard
        grid={vs.grid}
        selfPlayerId={vs.self.id}
        highlightedCells={placementCells}
        onCellClick={handlePlaceLocation}
      />

    {:else if step === "policy_selection"}
      <p class="mb-3 text-sm text-stone-400">Confirm policy selection.</p>
      <div class="mb-4 flex flex-wrap gap-2">
        {#each vs.self.policyPool as card}
          <CardView {card} />
        {/each}
      </div>
      <button
        onclick={handleSimpleAction}
        class="rounded bg-amber-600 px-6 py-2 font-semibold text-white hover:bg-amber-500"
      >
        Confirm Policy
      </button>
    {/if}
  </div>
</div>
