<script lang="ts">
  import {
    getCombatResult,
    dismissCombat,
    resolveCardName,
    resolvePlayerName,
    getVisibleState,
  } from "../lib/gameStore.svelte";

  const result = $derived(getCombatResult());
  const vs = $derived(getVisibleState());

  const locationName = $derived.by(() => {
    if (!result || !vs) return "";
    const cell = vs.grid[result.row]?.[result.col];
    return cell?.location?.name ?? `(${result.row},${result.col})`;
  });
</script>

{#if result}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
    <div class="w-96 rounded-lg bg-surface p-5">
      <h3 class="mb-3 text-center text-lg font-bold text-text-primary">
        Combat at {locationName}
      </h3>

      <div class="mb-4 flex items-center justify-center gap-3 text-sm">
        <span class="font-semibold text-self">
          {resolvePlayerName(result.attackerId)}
        </span>
        <span class="text-text-faint">vs</span>
        <span class="font-semibold text-opponent">
          {resolvePlayerName(result.defenderId)}
        </span>
      </div>

      {#if result.outcomes.length > 0}
        <div class="mb-4 space-y-1">
          {#each result.outcomes as outcome}
            <div class="flex items-center gap-2 rounded bg-surface-raised px-3 py-1.5 text-sm">
              {#if outcome.type === "injured"}
                <span class="text-stat-strength">!</span>
                <span class="text-text-secondary">
                  {resolveCardName(outcome.unitId)}
                  <span class="text-text-muted">({resolvePlayerName(outcome.ownerId)})</span>
                  was injured
                </span>
              {:else}
                <span class="text-danger">✕</span>
                <span class="text-text-secondary">
                  {resolveCardName(outcome.unitId)}
                  <span class="text-text-muted">({resolvePlayerName(outcome.ownerId)})</span>
                  was killed
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="mb-4 text-center text-sm text-text-muted">No casualties — draw!</p>
      {/if}

      <div class="mb-4 text-center text-sm font-semibold">
        {#if result.winnerId}
          <span class="text-highlight">
            {resolvePlayerName(result.winnerId)} wins!
          </span>
        {:else}
          <span class="text-text-muted">Draw — no clear winner</span>
        {/if}
      </div>

      <button
        onclick={dismissCombat}
        class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500"
      >
        Continue
      </button>
    </div>
  </div>
{/if}
