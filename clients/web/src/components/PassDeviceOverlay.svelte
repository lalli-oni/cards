<script lang="ts">
  import { confirmPassDevice, getCurrentPlayerName } from "../lib/gameStore.svelte";

  const name = $derived(getCurrentPlayerName());
</script>

<div
  class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-stone-900"
>
  <p class="mb-8 text-2xl text-stone-300">Pass the device to</p>
  <p class="mb-12 text-4xl font-bold text-amber-400">{name}</p>
  <button
    onclick={confirmPassDevice}
    class="rounded-lg bg-amber-600 px-8 py-3 text-lg font-semibold text-white hover:bg-amber-500"
  >
    I'm Ready
  </button>
</div>
