<script lang="ts">
  import type { OpponentView, PlayerState, VisibleState } from "cards-engine";

  interface Props {
    vs: VisibleState;
  }

  let { vs }: Props = $props();

  const self: PlayerState = $derived(vs.self);
  const opponent: OpponentView | undefined = $derived(vs.opponents[0]);
</script>

<div class="flex items-center justify-between rounded-lg bg-stone-800 px-4 py-2">
  <!-- Self -->
  <div class="flex items-center gap-4">
    <span class="font-bold text-amber-400">{self.name}</span>
    <span class="text-stone-300" title="Gold">💰 {self.gold}</span>
    <span class="text-stone-300" title="Victory Points">⭐ {self.vp}</span>
    <span class="text-stone-300" title="Hand size">🃏 {self.hand.length}</span>
    <span class="text-stone-300" title="Main deck">📚 {self.mainDeck.length}</span>
  </div>

  <!-- Turn info -->
  {#if vs.turn}
    <div class="flex items-center gap-3 text-stone-400">
      <span>Round {vs.turn.round}</span>
      <span class="font-semibold text-amber-300" title="Action Points">
        AP: {vs.turn.actionPointsRemaining}
      </span>
    </div>
  {/if}

  <!-- Opponent -->
  {#if opponent}
    <div class="flex items-center gap-4">
      <span class="text-stone-300" title="Main deck">📚 {opponent.mainDeckSize}</span>
      <span class="text-stone-300" title="Hand size">🃏 {opponent.handSize}</span>
      <span class="text-stone-300" title="Victory Points">⭐ {opponent.vp}</span>
      <span class="text-stone-300" title="Gold">💰 {opponent.gold}</span>
      <span class="font-bold text-stone-400">{opponent.name}</span>
    </div>
  {/if}
</div>
