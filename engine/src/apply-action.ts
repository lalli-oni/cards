import { applyMainAction } from "./apply-main";
import { applySeedingAction } from "./apply-seeding";
import type { Action, ApplyResult, GameState, MainAction } from "./types";
import { isSeedingAction } from "./types";

export type { ApplyResult };

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
    if (!state.seedingState) {
      throw new Error("seedingState is not initialized");
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
