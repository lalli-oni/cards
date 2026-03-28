import type {
  GameState,
  OpponentView,
  PlayerState,
  TrapView,
  VisibleState,
} from "./types";
import { getActivePlayerId } from "./types";

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

  // When player has no team, all others are opponents.
  // When player has a team, non-teammates are opponents.
  const isTeammate = (p: PlayerState) =>
    p.id !== playerId && self.team != null && p.team === self.team;

  const opponents: OpponentView[] = state.players
    .filter((p) => p.id !== playerId && !isTeammate(p))
    .map(toOpponentView);

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
    winner: state.phase === "ended" ? state.winner : undefined,
    scores: state.phase === "ended" ? state.scores : undefined,
  };
}

function toOpponentView(player: PlayerState): OpponentView {
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
    // Traps are face-down: show that they exist and their target, but not the card
    activeTraps: player.activeTraps.map(redactTrap),
  };
}

function redactTrap(trap: { targetId?: string }): TrapView {
  return { targetId: trap.targetId };
}
