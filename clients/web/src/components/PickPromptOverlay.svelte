<script lang="ts">
  import { getRejectionNonce, getVisibleState, selectAction, setError } from "../lib/gameStore.svelte";
  import { resolvePickOptions, togglePickSelection } from "../lib/pickPrompt";
  import { shouldReenableAfterRejection } from "../lib/promptRecovery";
  import CardView from "./CardView.svelte";
  import Modal from "./Modal.svelte";

  const vs = $derived(getVisibleState());
  // This overlay is the `deck_pick` "choose N to keep" UI; `scholar_reorder`
  // (no `count`, needs an ordering UI) is not handled here. Narrow to the
  // deck_pick variant so `count` is well-typed and a scholar prompt renders
  // nothing rather than a broken count-less dialog.
  const prompt = $derived(
    vs?.pickPrompt?.kind === "deck_pick" ? vs.pickPrompt : undefined,
  );
  const resolution = $derived(
    prompt && vs ? resolvePickOptions(prompt, vs.self.mainDeck) : null,
  );

  // Surface broken engine/client invariant via the global error banner.
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

  let selected = $state<ReadonlySet<string>>(new Set<string>());
  let submitted = $state(false);
  // The rejection-nonce value captured at submit; the effect below unlocks
  // Confirm when it advances (this submission was rejected).
  let nonceAtSubmit = $state(0);

  // If the engine rejects THIS submission mid-submit, unlock the button so the
  // user can try again. Keys off the monotonic rejection nonce (shared with
  // CombatPromptOverlay) rather than any error being present, so an unrelated
  // banner can't leave Confirm stuck or unlock it spuriously.
  const rejectionNonce = $derived(getRejectionNonce());
  $effect(() => {
    if (shouldReenableAfterRejection(submitted, rejectionNonce, nonceAtSubmit)) {
      submitted = false;
    }
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
    nonceAtSubmit = rejectionNonce;
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
