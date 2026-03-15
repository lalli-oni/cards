import type { GameState, VisibleState, OpponentView, PlayerState } from "./types";

/**
 * Return a filtered view of the state for a specific player.
 * Hides opponent hands, deck contents, and other hidden information.
 * Teammates share full visibility.
 */
export function getVisibleState(state: GameState, playerId: string): VisibleState {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) {
    throw new Error(`Player "${playerId}" not found in game state`);
  }

  const opponents: OpponentView[] = state.players
    .filter((p) => p.id !== playerId && p.team !== self.team)
    .map(toOpponentView);

  // Teammates get full visibility
  const teammates = state.players.filter(
    (p) => p.id !== playerId && p.team != null && p.team === self.team,
  );

  return {
    config: state.config,
    phase: state.phase,
    turn: state.turn,
    playerId,
    self,
    teammates,
    opponents,
    grid: state.grid,
    market: state.market,
    turnOrder: state.turnOrder,
    winner: state.winner,
    scores: state.scores,
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
    mainDeckSize: player.mainDeck.length,
    marketDeckSize: player.marketDeck.length,
    prospectDeckSize: player.prospectDeck.length,
    discardPileSize: player.discardPile.length,
    hq: player.hq,
    activePolicies: player.activePolicies,
    activeTraps: player.activeTraps,
  };
}
