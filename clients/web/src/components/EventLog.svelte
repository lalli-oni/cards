<script lang="ts">
  import { getEventLog, getVisibleState } from "../lib/gameStore.svelte";
  import { describeEvent, categorizeEvent } from "../lib/eventDescriptions";

  let collapsed = $state(false);
  let showPlayer = $state(true);
  let showOpponent = $state(true);
  let showSystem = $state(false);
  let logContainer: HTMLDivElement | undefined = $state();

  const events = $derived(getEventLog());
  const vs = $derived(getVisibleState());
  const selfPlayerId = $derived(vs?.currentPlayerId ?? "");

  const filteredEvents = $derived(
    events.filter((e) => {
      const cat = categorizeEvent(e, selfPlayerId);
      if (cat === "player") return showPlayer;
      if (cat === "opponent") return showOpponent;
      return showSystem;
    }),
  );

  $effect(() => {
    if (filteredEvents.length && logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });
</script>

<div class="flex flex-col rounded-lg bg-stone-800">
  <div class="flex items-center justify-between px-3 py-2">
    <button
      onclick={() => (collapsed = !collapsed)}
      class="text-sm font-semibold text-stone-300 hover:text-stone-100"
    >
      <span>Event Log ({filteredEvents.length})</span>
      <span class="ml-1">{collapsed ? "▶" : "▼"}</span>
    </button>

    {#if !collapsed}
      <div class="flex gap-1">
        <button
          onclick={() => (showPlayer = !showPlayer)}
          class="rounded px-2 py-0.5 text-2xs font-medium {showPlayer
            ? 'bg-emerald-800 text-emerald-200'
            : 'bg-stone-700 text-stone-500'}"
        >
          You
        </button>
        <button
          onclick={() => (showOpponent = !showOpponent)}
          class="rounded px-2 py-0.5 text-2xs font-medium {showOpponent
            ? 'bg-rose-800 text-rose-200'
            : 'bg-stone-700 text-stone-500'}"
        >
          Opponent
        </button>
        <button
          onclick={() => (showSystem = !showSystem)}
          class="rounded px-2 py-0.5 text-2xs font-medium {showSystem
            ? 'bg-stone-600 text-stone-200'
            : 'bg-stone-700 text-stone-500'}"
        >
          System
        </button>
      </div>
    {/if}
  </div>

  {#if !collapsed}
    <div
      bind:this={logContainer}
      class="max-h-48 overflow-y-auto border-t border-stone-700 px-3 py-2"
    >
      {#each filteredEvents as event}
        {#if event.type === "turn_started"}
          <div
            class="my-2 border-t border-stone-600 pt-2 text-center text-2xs font-semibold text-stone-500"
          >
            {describeEvent(event)}
          </div>
        {:else}
          <div class="text-xs leading-relaxed text-stone-400">
            {describeEvent(event)}
          </div>
        {/if}
      {/each}
      {#if filteredEvents.length === 0}
        <div class="text-xs italic text-stone-500">No events yet</div>
      {/if}
    </div>
  {/if}
</div>
