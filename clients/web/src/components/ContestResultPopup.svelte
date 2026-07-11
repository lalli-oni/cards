<script lang="ts">
  import {
    getContestResult,
    dismissContest,
    type ContestResult,
    type PairSideView,
  } from "../lib/gameStore.svelte";
  import { buildDialogView, type ContestOutcome, type DialogView } from "../lib/contestResult";
  import Modal from "./Modal.svelte";

  const result: ContestResult | null = $derived(getContestResult());

  function signed(delta: number): string {
    return delta >= 0 ? `+${delta}` : `${delta}`;
  }

  // Which player owns the unit in an outcome, so the row can align to that side
  // (attacker/Player 1 → left, defender/Player 2 → right). Compares player ids
  // (not display names, which can collide). Only combat results carry the side
  // ids and the multi-pair layout this mirrors.
  function outcomeSide(outcome: ContestOutcome): "attacker" | "defender" | null {
    if (!result || result.source !== "combat") return null;
    if (outcome.type === "injured" || outcome.type === "killed") {
      if (outcome.ownerId === result.attackerId) return "attacker";
      if (outcome.ownerId === result.defenderId) return "defender";
    }
    return null;
  }

  const view: DialogView | null = $derived(result ? buildDialogView(result) : null);
</script>

{#snippet sideBreakdown(side: PairSideView, isWinner: boolean)}
  <div
    class="flex-1 rounded p-2 text-xs {isWinner
      ? 'bg-highlight/15 ring-1 ring-highlight'
      : 'bg-surface-raised'}"
  >
    <div class="mb-1 font-semibold text-text-primary">
      {side.unitName}
      <span class="text-text-muted">({side.ownerName})</span>
    </div>
    <div class="flex flex-wrap items-center gap-1 text-text-secondary">
      <span class="font-mono">{side.baseStat}</span>
      {#each side.modifiers as mod}
        <span
          class="rounded bg-surface px-1.5 py-0.5 font-mono {mod.delta > 0
            ? 'text-success'
            : mod.delta < 0
              ? 'text-error'
              : 'text-text-secondary'}"
          title="{mod.source.type}: {mod.source.definitionId}"
        >
          {signed(mod.delta)} {mod.source.definitionId}
        </span>
      {/each}
      <span class="font-mono">+ {side.roll}🎲</span>
      <span class="ml-auto font-mono font-semibold text-text-primary">= {side.power}</span>
    </div>
  </div>
{/snippet}

{#if result && view}
  <Modal>
    <h3 class="mb-3 text-center text-lg font-bold text-text-primary">
      {view.title}
    </h3>

    <div class="mb-4 flex items-center justify-center gap-3 text-sm">
      <span class="font-semibold text-self">
        {result.attackerName}
      </span>
      <span class="text-text-faint">vs</span>
      <span class="font-semibold text-opponent">
        {result.defenderName}
      </span>
    </div>

    {#if result.pairs.length > 0}
      <div class="mb-4 space-y-2">
        {#each result.pairs as pair, i}
          <div class="rounded border border-border bg-surface p-2">
            {#if view.showPairCaption}
              <div class="mb-1 text-xs text-text-muted">Pair {i + 1}</div>
            {/if}
            <div class="flex gap-2">
              {@render sideBreakdown(pair.attacker, pair.winnerSide === "attacker")}
              <span class="self-center text-text-faint">vs</span>
              {@render sideBreakdown(pair.defender, pair.winnerSide === "defender")}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if result.outcomes.length > 0}
      <div class="mb-4 space-y-1">
        {#each result.outcomes as outcome}
          {@const side = outcomeSide(outcome)}
          <div
            class="flex w-fit max-w-[90%] items-center gap-2 rounded bg-surface-raised px-3 py-1.5 text-sm {side ===
            'defender'
              ? 'ml-auto flex-row-reverse text-right'
              : ''}"
          >
            {#if outcome.type === "injured"}
              <span>🩸</span>
              <span class="text-text-secondary">
                {outcome.unitName}
                <span class="text-text-muted">({outcome.ownerName})</span>
                injured
              </span>
            {:else if outcome.type === "killed"}
              <span>💀</span>
              <span class="text-text-secondary">
                {outcome.unitName}
                <span class="text-text-muted">({outcome.ownerName})</span>
                killed
              </span>
            {:else if outcome.type === "controlled"}
              <span>🪄</span>
              <span class="text-text-secondary">
                {outcome.newControllerName} takes control of {outcome.unitName}
                <span class="text-text-muted">({outcome.previousControllerName})</span>
                for {outcome.durationTurns} turn{outcome.durationTurns === 1 ? "" : "s"}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {:else if view.emptyOutcomesMsg}
      <p class="mb-4 text-center text-sm text-text-muted">{view.emptyOutcomesMsg}</p>
    {/if}

    {#if result.source === "combat" && result.retreatedName}
      <p class="mb-4 text-center text-sm font-semibold text-text-secondary">
        🏳️ {result.retreatedName} retreated to HQ
      </p>
    {/if}

    {#if result.winnerName}
      <div class="mb-4 text-center text-sm font-semibold">
        <span class="text-highlight">
          {result.winnerName} wins!
        </span>
      </div>
    {/if}

    <button
      onclick={dismissContest}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500"
    >
      Continue
    </button>
  </Modal>
{/if}
