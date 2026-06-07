<script lang="ts">
  import { getVisibleState, selectAction } from "../lib/gameStore.svelte";
  import CardView from "./CardView.svelte";
  import Modal from "./Modal.svelte";

  const vs = $derived(getVisibleState());
  const prompt = $derived(vs?.viewPrompt);
  const sourceName: string = $derived(
    vs?.opponents.find((o) => o.id === prompt?.sourcePlayerId)?.name
      ?? prompt?.sourcePlayerId
      ?? "",
  );

  let submitted = $state(false);

  // Reset submit lock when the prompt changes (defensive — today the outer
  // `{#if vs?.viewPrompt}` unmounts on dismiss).
  $effect(() => {
    void prompt?.cards.length;
    submitted = false;
  });

  function dismiss(): void {
    if (!prompt || submitted) return;
    submitted = true;
    selectAction({ type: "dismiss_view", playerId: prompt.playerId });
  }
</script>

{#if prompt}
  <Modal width="w-auto max-w-3xl">
    <h3 class="mb-2 text-center text-lg font-bold text-text-primary">
      {sourceName}'s hand
    </h3>
    <p class="mb-4 text-center text-sm text-text-muted">
      {#if prompt.cards.length === 0}
        Hand is empty.
      {:else}
        {prompt.cards.length} card{prompt.cards.length === 1 ? "" : "s"}.
      {/if}
    </p>

    {#if prompt.cards.length > 0}
      <div class="mb-4 flex flex-wrap justify-center gap-3">
        {#each prompt.cards as card (card.id)}
          <CardView {card} />
        {/each}
      </div>
    {/if}

    <button
      onclick={dismiss}
      disabled={submitted}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitted ? "Dismissing…" : "Dismiss"}
    </button>
  </Modal>
{/if}
