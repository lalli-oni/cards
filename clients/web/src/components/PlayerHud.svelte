<script lang="ts">
  import type { OpponentView, PlayerState, VisibleState } from "cards-engine";
  import StatusEffectsBar from "./StatusEffectsBar.svelte";

  interface Props {
    vs: VisibleState;
  }

  let { vs }: Props = $props();

  const self: PlayerState = $derived(vs.self);
  const opponent: OpponentView | undefined = $derived(vs.opponents[0]);

  const selfHasEffects = $derived(
    self.activePolicies.length > 0 ||
      self.activeTraps.length > 0 ||
      self.passiveEvents.length > 0,
  );
  const opponentHasEffects = $derived(
    opponent !== undefined &&
      (opponent.activePolicies.length > 0 ||
        opponent.activeTraps.length > 0),
  );
</script>

<div class="flex gap-4 rounded-lg bg-surface px-4 py-2">
  <!-- Self -->
  <div class="flex flex-1 flex-col gap-1">
    <div class="flex items-center gap-3 text-sm">
      <span class="font-bold text-identity">{self.name}</span>
      <span class="text-text-secondary" title="Gold">💰{self.gold}</span>
      <span class="text-text-secondary" title="Victory Points">⭐{self.vp}</span>
      <span class="text-text-secondary" title="Hand size">✋{self.hand.length}</span>
    </div>
    <div class="flex gap-3 text-xs text-text-faint">
      <span title="Main deck">📚 Main:{self.mainDeck.length}</span>
      <span title="Prospect deck">🗺️ Prospect:{self.prospectDeck.length}</span>
      <span title="Market deck">🏪 Market:{self.marketDeck.length}</span>
      <span title="Discard pile">♻️ Discard:{self.discardPile.length}</span>
      {#if self.removedFromGame.length > 0}
        <span title="Cards removed from game: {self.removedFromGame.map(c => c.name).join(', ')}">
          ❌ Removed:{self.removedFromGame.length}
        </span>
      {/if}
    </div>
    {#if selfHasEffects}
      <StatusEffectsBar
        policies={self.activePolicies}
        traps={self.activeTraps}
        passiveEvents={self.passiveEvents}
        isSelf={true}
        {vs}
      />
    {/if}
  </div>

  <!-- Turn info (center) -->
  {#if vs.turn}
    <div class="flex flex-col items-center justify-center gap-0.5 text-sm text-text-muted">
      <span>Round {vs.turn.round}</span>
      <span class="font-semibold text-identity-resource">
        Action Points: {vs.turn.actionPointsRemaining}
      </span>
      <span class="text-xs">
        Active: {vs.turn.activePlayerId === self.id ? self.name : opponent?.name ?? vs.turn.activePlayerId}
      </span>
    </div>
  {/if}

  <!-- Opponent -->
  {#if opponent}
    <div class="flex flex-1 flex-col items-end gap-1">
      <div class="flex items-center gap-3 text-sm">
        <span class="font-bold text-text-muted">{opponent.name}</span>
        <span class="text-text-secondary" title="Gold">💰{opponent.gold}</span>
        <span class="text-text-secondary" title="Victory Points">⭐{opponent.vp}</span>
        <span class="text-text-secondary" title="Hand size">✋{opponent.handSize}</span>
      </div>
      <div class="flex gap-3 text-xs text-text-faint">
        <span title="Main deck">📚 Main:{opponent.mainDeckSize}</span>
        <span title="Prospect deck">🗺️ Prospect:{opponent.prospectDeckSize}</span>
        <span title="Market deck">🏪 Market:{opponent.marketDeckSize}</span>
        <span title="Discard pile">♻️ Discard:{opponent.discardPileSize}</span>
      </div>
      {#if opponentHasEffects}
        <StatusEffectsBar
          policies={opponent.activePolicies}
          traps={opponent.activeTraps}
          isSelf={false}
          {vs}
        />
      {/if}
    </div>
  {/if}
</div>
