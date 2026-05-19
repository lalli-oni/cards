<script lang="ts">
  import { getError, getVisibleState, selectAction, setError } from "../lib/gameStore.svelte";
  import { resolvePickOptions, togglePickSelection } from "../lib/pickPrompt";
  import CardView from "./CardView.svelte";
  import Modal from "./Modal.svelte";

  const vs = $derived(getVisibleState());
  const prompt = $derived(vs?.pickPrompt);
  const resolution = $derived(
    prompt && vs ? resolvePickOptions(prompt, vs.self.mainDeck) : null,
  );

  // Engine invariant: every option id is findable in mainDeck while the prompt
  // is set. When that fails, fail loud via the global error banner rather than
  // soft-locking the dialog.
  $effect(() => {
    if (resolution && !resolution.ok && prompt) {
      console.error(
        "PickPromptOverlay: option ids missing from mainDeck — engine/client invariant broken",
        { missing: resolution.missing, promptOptions: prompt.options },
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
    selected = togglePickSelection(selected, cardId, prompt.count);
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

{#if prompt && resolution?.ok}
  <Modal width="w-auto max-w-3xl">
    <h3 class="mb-2 text-center text-lg font-bold text-text-primary">
      Choose {prompt.count} card{prompt.count === 1 ? "" : "s"} to keep
    </h3>
    <p class="mb-4 text-center text-sm text-text-muted">
      Looked at the top {prompt.options.length} of your main deck.
    </p>

    <div class="mb-4 flex flex-wrap justify-center gap-3">
      {#each resolution.found as card (card.id)}
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
