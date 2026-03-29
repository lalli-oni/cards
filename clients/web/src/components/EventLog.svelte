<script lang="ts">
  import { getEventLog } from "../lib/gameStore.svelte";
  import { describeEvent } from "../lib/eventDescriptions";

  let collapsed = $state(false);
  let logContainer: HTMLDivElement | undefined = $state();

  const events = $derived(getEventLog());

  $effect(() => {
    // Auto-scroll when events change
    if (events.length && logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });
</script>

<div class="flex flex-col rounded-lg bg-stone-800">
  <button
    onclick={() => (collapsed = !collapsed)}
    class="flex items-center justify-between px-3 py-2 text-sm font-semibold text-stone-300 hover:text-stone-100"
  >
    <span>Event Log ({events.length})</span>
    <span>{collapsed ? "▶" : "▼"}</span>
  </button>

  {#if !collapsed}
    <div
      bind:this={logContainer}
      class="max-h-48 overflow-y-auto border-t border-stone-700 px-3 py-2"
    >
      {#each events as event, i}
        <div class="text-xs text-stone-400 leading-relaxed">
          {describeEvent(event)}
        </div>
      {/each}
      {#if events.length === 0}
        <div class="text-xs text-stone-500 italic">No events yet</div>
      {/if}
    </div>
  {/if}
</div>
