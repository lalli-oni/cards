import type {
  GameEvent,
  GameState,
  MainGameState,
  OpponentView,
  PlayerState,
  Reveals,
  Trap,
  TrapView,
  VisibleState,
} from "./types";
import { getActivePlayerId } from "./types";
import {
  ITEM_EFFECTS,
  LOCATION_EFFECTS,
  PASSIVE_EVENT_EFFECTS,
  POLICY_EFFECTS,
  TRAP_EFFECTS,
  UNIT_EFFECTS,
} from "./listeners/effects";
import type { RevealsProvider } from "./listeners/types";

/**
 * Return a filtered view of the state for a specific player.
 * Hides opponent hands, deck contents, and other hidden information.
 * Teammates share full visibility.
 */
export function getVisibleState(
  state: GameState,
  playerId: string,
): VisibleState {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) {
    throw new Error(`Player "${playerId}" not found in game state`);
  }

  const reveals = state.phase === "main" || state.phase === "ended"
    ? computeReveals(state as MainGameState, playerId)
    : { revealedTrapIds: [] };

  // When player has no team, all others are opponents.
  // When player has a team, non-teammates are opponents.
  const isTeammate = (p: PlayerState) =>
    p.id !== playerId && self.team != null && p.team === self.team;

  const opponents: OpponentView[] = state.players
    .filter((p) => p.id !== playerId && !isTeammate(p))
    .map((p) => toOpponentView(p, reveals.revealedTrapIds));

  const teammates = state.players.filter(isTeammate);

  const currentPlayerId =
    state.phase === "ended"
      ? state.turn.activePlayerId
      : getActivePlayerId(state);

  return {
    config: state.config,
    phase: state.phase,
    turn:
      state.phase === "main" || state.phase === "ended"
        ? state.turn
        : undefined,
    currentPlayerId,
    playerId,
    self,
    teammates,
    opponents,
    grid: state.grid,
    market: state.market,
    turnOrder: state.players.map((p) => p.id),
    middleArea: state.phase === "seeding" ? state.seedingState.middleArea : [],
    seedingStep:
      state.phase === "seeding" ? state.seedingState.step : undefined,
    // pickPrompt is private to the picker — peek() options must not leak to opponents.
    // Surfaces in both main and seeding phases so passives like Scholar's
    // top-5 reorder can prompt during seeding.
    pickPrompt:
      state.phase !== "ended" && state.pickPrompt?.playerId === playerId
        ? state.pickPrompt
        : undefined,
    // viewPrompt is private to the viewer — opponent hand contents must not
    // leak through this surface. The `phase === "main"` guard is required
    // for type narrowing (viewPrompt only exists on MainGameState).
    viewPrompt:
      state.phase === "main" && state.viewPrompt?.playerId === playerId
        ? state.viewPrompt
        : undefined,
    winner: state.phase === "ended" ? state.winner : undefined,
    scores: state.phase === "ended" ? state.scores : undefined,
    reveals,
  };
}

function toOpponentView(player: PlayerState, revealedTrapIds: string[]): OpponentView {
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    gold: player.gold,
    vp: player.vp,
    handSize: player.hand.length,
    seedingDeckSize: player.seedingDeck.length,
    mainDeckSize: player.mainDeck.length,
    marketDeckSize: player.marketDeck.length,
    prospectDeckSize: player.prospectDeck.length,
    discardPileSize: player.discardPile.length,
    hq: player.hq,
    activePolicies: player.activePolicies,
    // Traps are face-down: show that they exist and their target, but redact
    // card contents unless the viewer has explicit reveal rights for this trap.
    activeTraps: player.activeTraps.map((t) => redactTrap(t, revealedTrapIds)),
    passiveEvents: player.passiveEvents,
  };
}

function redactTrap(trap: Trap, revealedTrapIds: string[]): TrapView {
  const view: TrapView = { targetId: trap.targetId, cardId: trap.card.id };
  if (revealedTrapIds.includes(trap.card.id)) {
    view.card = trap.card;
    // Defensive invariant: revealed `card.id` must equal `cardId`. A
    // mismatch indicates an upstream bug populating revealedTrapIds with
    // ids that don't belong to this trap.
    if (view.card.id !== view.cardId) {
      throw new Error(
        `redactTrap invariant: revealed card id "${view.card.id}" does not match cardId "${view.cardId}"`,
      );
    }
  }
  return view;
}

/**
 * Compute the union of reveal contributions from all active cards for a
 * specific viewer. Walks the same surfaces as rebuildListeners; each card's
 * factory may return a `reveals` provider that maps (state, viewerId) →
 * partial Reveals. Contributions are merged: mainDeckTop must be set by at
 * most one provider per viewer (throw on conflict — see assertion below);
 * revealedTrapIds are deduped.
 */
function computeReveals(state: MainGameState, viewerId: string): Reveals {
  const result: Reveals = { revealedTrapIds: [] };
  const trapIds = new Set<string>();

  const apply = (provider: RevealsProvider | undefined) => {
    if (!provider) return;
    const contribution = provider(state, viewerId);
    if (contribution.mainDeckTop) {
      if (result.mainDeckTop && result.mainDeckTop.id !== contribution.mainDeckTop.id) {
        // No two passives should grant mainDeckTop for the same viewer.
        // Surface as an invariant violation rather than silently picking
        // the iteration-order winner.
        throw new Error(
          `computeReveals invariant: multiple providers contributed conflicting mainDeckTop for viewer "${viewerId}" (saw "${result.mainDeckTop.id}" then "${contribution.mainDeckTop.id}")`,
        );
      }
      result.mainDeckTop = contribution.mainDeckTop;
    }
    for (const id of contribution.revealedTrapIds ?? []) trapIds.add(id);
  };

  // Grid: locations, items, units
  for (let r = 0; r < state.grid.length; r++) {
    for (let c = 0; c < state.grid[r].length; c++) {
      const cell = state.grid[r][c];

      if (cell.location) {
        const factory = LOCATION_EFFECTS[cell.location.definitionId];
        if (factory) apply(factory(cell.location, cell.location.ownerId, r, c).reveals);
      }

      for (const item of cell.items) {
        const factory = ITEM_EFFECTS[item.definitionId];
        if (factory) apply(factory(item, item.ownerId, { row: r, col: c }).reveals);
      }

      for (const unit of cell.units) {
        const factory = UNIT_EFFECTS[unit.definitionId];
        if (factory) apply(factory(unit, unit.ownerId, { row: r, col: c }).reveals);
      }
    }
  }

  // Per-player: policies, passive events, traps, HQ items + units
  for (const player of state.players) {
    for (const policy of player.activePolicies) {
      const factory = POLICY_EFFECTS[policy.definitionId];
      if (factory) apply(factory(policy, player.id).reveals);
    }
    for (const pe of player.passiveEvents) {
      const factory = PASSIVE_EVENT_EFFECTS[pe.definitionId];
      if (factory) apply(factory(pe, player.id).reveals);
    }
    for (const trap of player.activeTraps) {
      const factory = TRAP_EFFECTS[trap.card.definitionId];
      if (factory) apply(factory(trap, player.id).reveals);
    }
    for (const card of player.hq) {
      if (card.type === "item") {
        const factory = ITEM_EFFECTS[card.definitionId];
        if (factory) apply(factory(card, player.id).reveals);
      } else if (card.type === "unit") {
        const factory = UNIT_EFFECTS[card.definitionId];
        if (factory) apply(factory(card, player.id).reveals);
      }
    }
  }

  result.revealedTrapIds = Array.from(trapIds);
  return result;
}

/**
 * Project a single event into what a specific viewer is allowed to see.
 *
 * The engine emits events god-view; this helper is the privacy boundary.
 * Callers that want the raw stream (replays, balance analysis, test
 * runners) skip it. Add a case here when introducing a viewer-private
 * field on a new event type; the default branch passes through.
 */
export function getVisibleEvent(event: GameEvent, viewerId: string): GameEvent {
  switch (event.type) {
    case "card_drawn":
      if (event.playerId === viewerId) return event;
      return { type: "card_drawn", playerId: event.playerId, count: event.count };
    default:
      return event;
  }
}

/** Map a stream of events through `getVisibleEvent` for the given viewer. */
export function getVisibleEvents(events: GameEvent[], viewerId: string): GameEvent[] {
  return events.map((e) => getVisibleEvent(e, viewerId));
}
