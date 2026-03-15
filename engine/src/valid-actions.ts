import type { GameState, Action } from "./types";

/**
 * Return all legal actions for a player given the current state.
 * Used by clients (to show available moves) and bots (to choose a move).
 */
export function getValidActions(state: GameState, playerId: string): Action[] {
  // A player can only act on their own turn
  if (state.turn.activePlayerId !== playerId) {
    return [];
  }

  if (state.phase === "ended") {
    return [];
  }

  const actions: Action[] = [];

  // The player can always pass
  actions.push({ type: "pass", playerId });

  // TODO: compute valid actions based on phase, AP, board state, hand, etc.

  return actions;
}
