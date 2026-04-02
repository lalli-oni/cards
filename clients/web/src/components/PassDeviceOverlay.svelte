<script lang="ts">
  import {
    confirmPassDevice,
    getCurrentPlayerName,
    getLastTurnEvents,
  } from "../lib/gameStore.svelte";
  import { describeEvent } from "../lib/eventDescriptions";

  const name = $derived(getCurrentPlayerName());
  const turnEvents = $derived(getLastTurnEvents());

  let logContainer: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (turnEvents.length && logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-stone-900">
  <!-- Opponent's turn events -->
  <div class="min-h-0 flex-1 overflow-hidden px-4 pt-4">
    {#if turnEvents.length > 0}
      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">
        Last turn
      </p>
      <div
        bind:this={logContainer}
        class="h-full overflow-y-auto rounded-lg bg-stone-800 px-3 py-2"
      >
        {#each turnEvents as event}
          {#if event.type === "turn_started"}
            <div
              class="my-2 border-t border-stone-600 pt-2 text-center text-xs font-semibold text-stone-500"
            >
              {describeEvent(event)}
            </div>
          {:else}
            <div class="text-xs leading-relaxed text-stone-400">
              {describeEvent(event)}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Identity + ready button -->
  <div
    class="flex flex-col items-center gap-8 border-t border-stone-700 px-4 py-8"
  >
    <div class="text-center">
      <p class="mb-2 text-lg text-stone-300">Pass the device to</p>
      <p class="text-3xl font-bold text-amber-400">{name}</p>
    </div>
    <button
      onclick={confirmPassDevice}
      class="rounded-lg bg-amber-600 px-8 py-3 text-lg font-semibold text-white hover:bg-amber-500"
    >
      I'm Ready
    </button>
  </div>
</div>
