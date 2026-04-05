<script lang="ts">
  import {
    startNewGame,
    loadGame,
    refreshSessions,
    getSavedSessions,
    getError,
    clearError,
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

  function handleQuickStart() {
    startNewGame(p1Name, p2Name, seed || undefined, true);
  }

  async function handleLoad(key: string) {
    await loadGame(key);
  }

  async function handleDelete(key: string) {
    try {
      await deleteSession(key);
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
    await refreshSessions();
  }

  function displayName(key: string): string {
    if (key === "autosave") return "Autosave";
    return key.replace(/^session-/, "");
  }

  const sessions = $derived(getSavedSessions());
  const error = $derived(getError());
</script>

<div class="flex min-h-screen items-center justify-center bg-stone-900 p-4">
  <div class="w-full max-w-md space-y-8">
    <h1 class="text-center text-3xl font-bold text-stone-100">Cards</h1>

    {#if error}
      <div class="flex items-center justify-between rounded-lg bg-red-900/80 px-4 py-3">
        <span class="text-sm text-red-200">{error}</span>
        <button
          onclick={clearError}
          class="rounded bg-red-800 px-3 py-1 text-xs text-red-200 hover:bg-red-700"
        >
          Dismiss
        </button>
      </div>
    {/if}

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
      <div class="flex gap-2">
        <button
          onclick={handleStart}
          class="flex-1 rounded bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500"
        >
          Start Game
        </button>
        <button
          onclick={handleQuickStart}
          class="rounded bg-stone-600 px-4 py-2 text-sm text-stone-200 hover:bg-stone-500"
          title="Auto-play seeding phase with random choices"
        >
          Quick Start
        </button>
      </div>
    </div>

    {#if sessions.length > 0}
      <div class="space-y-3 rounded-lg bg-stone-800 p-6">
        <h2 class="text-lg font-semibold text-stone-200">Saved Games</h2>
        {#each sessions as key}
          <div class="flex items-center justify-between rounded bg-stone-700 px-3 py-2">
            <span class="text-stone-200">
              {displayName(key)}
              {#if key === "autosave"}
                <span class="ml-1 text-xs text-stone-400">(auto)</span>
              {/if}
            </span>
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
