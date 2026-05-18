<script lang="ts">
  import { getError, getVisibleState, selectAction, setError } from "../lib/gameStore.svelte";
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
  // Engine invariant: every option id is findable in mainDeck while the prompt
  // is set (peek slices non-destructively; the pre-produce guard rejects any
  // action but resolve_pick). If we find fewer cards than ids, something
  // out-of-band has mutated the deck — fail loud via the global error banner.
  const invariantBroken = $derived(
    !!prompt && optionCards.length !== prompt.options.length,
  );

  $effect(() => {
    if (invariantBroken && prompt && vs) {
      const missing = prompt.options.filter(
        (id) => !vs.self.mainDeck.some((c) => c.id === id),
      );
      console.error(
        "PickPromptOverlay: option ids missing from mainDeck — engine/client invariant broken",
        { missing, promptOptions: prompt.options },
      );
      setError(
        "Engine state is inconsistent (pick options missing from deck). " +
          "Return to menu and reload — your save may be corrupt.",
      );
    }
  });

  let selected = $state(new Set<string>());
  let submitted = $state(false);

  // If the engine surfaces an error while we're mid-submit, unlock the
  // button so the user can try again (retry may or may not succeed
  // depending on whether the controller is recoverable, but the button
  // shouldn't be permanently stuck).
  const error = $derived(getError());
  $effect(() => {
    if (error && submitted) submitted = false;
  });

  // Reset local picker state when the prompt changes content. Today the
  // outer `{#if vs?.pickPrompt}` unmounts and remounts the component on
  // every prompt transition, so this is defensive — protects against a
  // future refactor that keeps the component mounted across prompts.
  $effect(() => {
    void prompt?.options.join(",");
    selected = new Set();
    submitted = false;
  });

  function toggle(cardId: string): void {
    if (!prompt) return;
    const next = new Set(selected);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      // At the cap — drop the oldest selection FIFO so the user can
      // re-pick freely without manually deselecting first.
      if (next.size >= prompt.count) {
        const oldest = next.values().next().value;
        if (oldest !== undefined) next.delete(oldest);
      }
      next.add(cardId);
    }
    selected = next;
  }

  function confirm(): void {
    if (!prompt || selected.size !== prompt.count || submitted) return;
    submitted = true;
    selectAction({
      type: "resolve_pick",
      playerId: prompt.playerId,
      pickedCardIds: [...selected] as [string, ...string[]],
    });
    // Don't clear `selected` here — the component unmounts when the engine
    // clears pickPrompt on success, and on failure we preserve the user's
    // selection so they can retry without re-picking from scratch.
  }
</script>

{#if prompt && !invariantBroken}
  <Modal width="w-auto max-w-3xl">
    <h3 class="mb-2 text-center text-lg font-bold text-text-primary">
      Choose {prompt.count} card{prompt.count === 1 ? "" : "s"} to keep
    </h3>
    <p class="mb-4 text-center text-sm text-text-muted">
      Looked at the top {prompt.options.length} of your main deck.
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
      disabled={selected.size !== prompt.count || submitted}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitted ? "Submitting…" : `Confirm (${selected.size} / ${prompt.count})`}
    </button>
  </Modal>
{/if}
