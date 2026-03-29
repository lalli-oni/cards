<script lang="ts">
  import {
    startNewGame,
    loadGame,
    refreshSessions,
    getSavedSessions,
  } from "../lib/gameStore.svelte";
  import { deleteSession } from "../lib/persistence";

  let p1Name = $state("Player 1");
  let p2Name = $state("Player 2");
  let seed = $state("");

  $effect(() => {
    refreshSessions();
  });

  function handleStart() {
    startNewGame(p1Name, p2Name, seed || undefined);
  }

  async function handleLoad(key: string) {
    await loadGame(key);
  }

  async function handleDelete(key: string) {
    await deleteSession(key);
    await refreshSessions();
  }

  const sessions = $derived(getSavedSessions());
</script>

<div class="flex min-h-screen items-center justify-center bg-stone-900 p-4">
  <div class="w-full max-w-md space-y-8">
    <h1 class="text-center text-3xl font-bold text-stone-100">Cards</h1>

    <div class="space-y-4 rounded-lg bg-stone-800 p-6">
      <h2 class="text-lg font-semibold text-stone-200">New Game</h2>
      <div class="space-y-2">
        <input
          type="text"
          bind:value={p1Name}
          placeholder="Player 1"
          class="w-full rounded bg-stone-700 px-3 py-2 text-stone-100 placeholder-stone-400"
        />
        <input
          type="text"
          bind:value={p2Name}
          placeholder="Player 2"
          class="w-full rounded bg-stone-700 px-3 py-2 text-stone-100 placeholder-stone-400"
        />
        <input
          type="text"
          bind:value={seed}
          placeholder="Seed (optional)"
          class="w-full rounded bg-stone-700 px-3 py-2 text-stone-100 placeholder-stone-400"
        />
      </div>
      <button
        onclick={handleStart}
        class="w-full rounded bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500"
      >
        Start Game
      </button>
    </div>

    {#if sessions.length > 0}
      <div class="space-y-3 rounded-lg bg-stone-800 p-6">
        <h2 class="text-lg font-semibold text-stone-200">Saved Games</h2>
        {#each sessions as key}
          <div class="flex items-center justify-between rounded bg-stone-700 px-3 py-2">
            <span class="text-stone-200">{key}</span>
            <div class="flex gap-2">
              <button
                onclick={() => handleLoad(key)}
                class="rounded bg-stone-600 px-3 py-1 text-sm text-stone-200 hover:bg-stone-500"
              >
                Load
              </button>
              <button
                onclick={() => handleDelete(key)}
                class="rounded bg-red-800 px-3 py-1 text-sm text-stone-200 hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
