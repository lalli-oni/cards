<script lang="ts">
  import {
    getScreen,
    getVisibleState,
    getValidActions,
    getGamePhase,
    saveGame,
  } from "./lib/gameStore.svelte";
  import StartScreen from "./components/StartScreen.svelte";
  import PassDeviceOverlay from "./components/PassDeviceOverlay.svelte";
  import SeedingPhase from "./components/SeedingPhase.svelte";
  import MainPhase from "./components/MainPhase.svelte";
  import EndedScreen from "./components/EndedScreen.svelte";
  import EventLog from "./components/EventLog.svelte";

  const screen = $derived(getScreen());
  const vs = $derived(getVisibleState());
  const actions = $derived(getValidActions());
  const phase = $derived(getGamePhase());

  let saveName = $state("");

  function handleSave() {
    if (saveName.trim()) {
      saveGame(saveName.trim());
      saveName = "";
    }
  }
</script>

{#if screen === "start"}
  <StartScreen />
{:else}
  <div class="flex h-screen flex-col bg-stone-900 p-3 text-stone-100">
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
            disabled={!saveName.trim()}
            class="rounded bg-stone-600 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-500
              disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
