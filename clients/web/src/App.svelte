<script lang="ts">
  import {
    getScreen,
    getVisibleState,
    getValidActions,
    getGamePhase,
    getError,
    clearError,
    saveGame,
    returnToMenu,
  } from "./lib/gameStore.svelte";
  import StartScreen from "./components/StartScreen.svelte";
  import PassDeviceOverlay from "./components/PassDeviceOverlay.svelte";
  import SeedingPhase from "./components/SeedingPhase.svelte";
  import MainPhase from "./components/MainPhase.svelte";
  import EndedScreen from "./components/EndedScreen.svelte";
  import EventLog from "./components/EventLog.svelte";
  // TODO: Remove DevPreview import and /#dev route once quick-start variant (#82) lands
  import DevPreview from "./DevPreview.svelte";

  const isDevPreview = window.location.hash === "#dev";
  const screen = $derived(getScreen());
  const vs = $derived(getVisibleState());
  const actions = $derived(getValidActions());
  const phase = $derived(getGamePhase());
  const error = $derived(getError());

  let saveName = $state("");
  let saving = $state(false);

  async function handleSave() {
    if (!saveName.trim() || saving) return;
    saving = true;
    await saveGame(saveName.trim());
    saving = false;
    saveName = "";
  }
</script>

{#if isDevPreview}
  <DevPreview />
{:else if screen === "start"}
  <StartScreen />
{:else}
  <div class="flex h-screen flex-col bg-stone-900 p-3 text-stone-100">
    {#if error}
      <div class="mb-3 flex items-center justify-between rounded-lg bg-red-900/80 px-4 py-3">
        <span class="text-sm text-red-200">{error}</span>
        <div class="flex gap-2">
          <button
            onclick={clearError}
            class="rounded bg-red-800 px-3 py-1 text-xs text-red-200 hover:bg-red-700"
          >
            Dismiss
          </button>
          <button
            onclick={returnToMenu}
            class="rounded bg-stone-700 px-3 py-1 text-xs text-stone-200 hover:bg-stone-600"
          >
            Main Menu
          </button>
        </div>
      </div>
    {/if}

    {#if screen === "passDevice"}
      <PassDeviceOverlay />
    {/if}

    {#if vs}
      {#if phase === "ended"}
        <EndedScreen />
      {:else if phase === "seeding"}
        <div class="min-h-0 flex-1">
          <SeedingPhase {vs} {actions} />
        </div>
      {:else if phase === "main"}
        <div class="min-h-0 flex-1">
          <MainPhase {vs} {actions} />
        </div>
      {/if}

      <!-- Bottom bar: event log + save -->
      <div class="mt-3 flex gap-3">
        <div class="flex-1">
          <EventLog />
        </div>
        <div class="flex items-end gap-2">
          <input
            type="text"
            bind:value={saveName}
            placeholder="Save name"
            class="rounded bg-stone-700 px-3 py-1.5 text-sm text-stone-100 placeholder-stone-400"
          />
          <button
            onclick={handleSave}
            disabled={!saveName.trim() || saving}
            class="rounded bg-stone-600 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-500
              disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
