import type { GameState, Action, GameEvent, MainAction } from "./types";
import { isSeedingAction } from "./types";
import { applySeedingAction } from "./apply-seeding";
import { applyMainAction } from "./apply-main";

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Apply a player action to the game state.
 * Routes to the appropriate phase handler.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  if (action.playerId !== state.turn.activePlayerId) {
    throw new Error(
      `Action from player "${action.playerId}" rejected: it is player "${state.turn.activePlayerId}"'s turn`,
    );
  }

  if (state.phase === "seeding") {
    if (!isSeedingAction(action)) {
      throw new Error(
        `Action type "${action.type}" is not valid during seeding phase`,
      );
    }
    return applySeedingAction(state, action);
  }

  if (state.phase === "main") {
    if (isSeedingAction(action)) {
      throw new Error(
        `Action type "${action.type}" is not valid during main phase`,
      );
    }
    return applyMainAction(state, action as MainAction);
  }

  throw new Error(`Cannot apply actions during "${state.phase}" phase`);
}
