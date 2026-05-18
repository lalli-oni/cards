<script lang="ts">
  import { getVisibleState, selectAction } from "../lib/gameStore.svelte";
  import CardView from "./CardView.svelte";
  import Modal from "./Modal.svelte";

  const vs = $derived(getVisibleState());
  const prompt = $derived(vs?.pickPrompt);
  const optionCards = $derived(
    prompt && vs
      ? prompt.options
          .map((id) => vs.self.mainDeck.find((c) => c.id === id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
      : [],
  );

  let selected = $state(new Set<string>());

  function toggle(cardId: string): void {
    const next = new Set(selected);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    selected = next;
  }

  function confirm(): void {
    if (!prompt || selected.size !== prompt.count) return;
    selectAction({
      type: "resolve_pick",
      playerId: prompt.playerId,
      pickedCardIds: [...selected] as [string, ...string[]],
    });
    selected = new Set();
  }
</script>

{#if prompt}
  <Modal width="w-auto max-w-3xl">
    <h3 class="mb-2 text-center text-lg font-bold text-text-primary">
      Choose {prompt.count} card{prompt.count === 1 ? "" : "s"} to keep
    </h3>
    <p class="mb-4 text-center text-sm text-text-muted">
      Looked at the top {optionCards.length} of your main deck.
    </p>

    <div class="mb-4 flex flex-wrap justify-center gap-3">
      {#each optionCards as card (card.id)}
        <CardView
          {card}
          highlighted={selected.has(card.id)}
          onclick={() => toggle(card.id)}
        />
      {/each}
    </div>

    <button
      onclick={confirm}
      disabled={selected.size !== prompt.count}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Confirm ({selected.size} / {prompt.count})
    </button>
  </Modal>
{/if}
