<script lang="ts">
  import { getVisibleState, returnToMenu } from "../lib/gameStore.svelte";

  const vs = $derived(getVisibleState());
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-stone-900 p-4">
  {#if vs}
    <h1 class="mb-4 text-3xl font-bold text-amber-400">Game Over</h1>
    {#if vs.winner}
      <p class="mb-6 text-xl text-stone-200">
        Winner: <span class="font-bold text-amber-300">{vs.winner}</span>
      </p>
    {:else}
      <p class="mb-6 text-xl text-stone-200">Draw!</p>
    {/if}

    {#if vs.scores}
      <div class="mb-8 rounded-lg bg-stone-800 p-4">
        <h2 class="mb-2 font-semibold text-stone-300">Scores</h2>
        {#each Object.entries(vs.scores) as [playerId, score]}
          <div class="flex justify-between gap-8 text-stone-200">
            <span>{playerId}</span>
            <span class="font-mono">{score} VP</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="flex gap-4">
    <button
      onclick={returnToMenu}
      class="rounded bg-stone-700 px-6 py-2 text-stone-200 hover:bg-stone-600"
    >
      Main Menu
    </button>
  </div>
</div>
