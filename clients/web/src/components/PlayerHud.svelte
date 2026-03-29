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

<div class="flex flex-col gap-1 rounded-lg bg-surface px-4 py-2">
  <!-- Row 1: Resources and turn info -->
  <div class="flex items-center justify-between">
    <!-- Self -->
    <div class="flex items-center gap-3 text-sm">
      <span class="font-bold text-identity">{self.name}</span>
      <span class="text-text-secondary" title="Gold">💰{self.gold}</span>
      <span class="text-text-secondary" title="Victory Points">⭐{self.vp}</span>
      <span class="text-text-secondary" title="Hand">🃏{self.hand.length}</span>
      <span class="text-text-muted" title="Main deck">📚{self.mainDeck.length}</span>
      <span class="text-xs text-text-faint" title="Prospect / Market / Discard">
        Prsp:{self.prospectDeck.length} Mkt:{self.marketDeck.length} Disc:{self.discardPile.length}
      </span>
    </div>

    <!-- Turn info -->
    {#if vs.turn}
      <div class="flex items-center gap-3 text-text-muted">
        <span>R{vs.turn.round}</span>
        <span class="font-semibold text-identity-resource" title="Action Points">
          AP:{vs.turn.actionPointsRemaining}
        </span>
      </div>
    {/if}

    <!-- Opponent -->
    {#if opponent}
      <div class="flex items-center gap-3 text-sm">
        <span class="text-xs text-text-faint" title="Prospect / Market / Discard">
          Disc:{opponent.discardPileSize} Mkt:{opponent.marketDeckSize} Prsp:{opponent.prospectDeckSize}
        </span>
        <span class="text-text-muted" title="Main deck">📚{opponent.mainDeckSize}</span>
        <span class="text-text-secondary" title="Hand">🃏{opponent.handSize}</span>
        <span class="text-text-secondary" title="Victory Points">⭐{opponent.vp}</span>
        <span class="text-text-secondary" title="Gold">💰{opponent.gold}</span>
        <span class="font-bold text-text-muted">{opponent.name}</span>
      </div>
    {/if}
  </div>

  <!-- Row 2: Active effects (only if any exist) -->
  {#if selfHasEffects || opponentHasEffects}
    <div class="flex items-start justify-between gap-4">
      <StatusEffectsBar
        policies={self.activePolicies}
        traps={self.activeTraps}
        passiveEvents={self.passiveEvents}
        isSelf={true}
      />
      {#if opponent && opponentHasEffects}
        <StatusEffectsBar
          policies={opponent.activePolicies}
          traps={opponent.activeTraps}
          isSelf={false}
        />
      {/if}
    </div>
  {/if}
</div>
