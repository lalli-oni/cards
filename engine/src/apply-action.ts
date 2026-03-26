import { applyMainAction } from "./apply-main";
import { applySeedingAction } from "./apply-seeding";
import type {
  ActionForState,
  ApplyResult,
  GameState,
  MainAction,
  SeedingAction,
} from "./types";
import { getActivePlayerId } from "./types";

export type { ApplyResult };

/**
 * Apply a player action to the game state.
 * Routes to the appropriate phase handler.
 *
 * The generic signature ensures callers with a narrowed state type
 * (e.g. MainGameState) can only pass the matching action type.
 */
export function applyAction<S extends GameState>(
  state: S,
  action: ActionForState<S>,
): ApplyResult {
  const activePlayerId = getActivePlayerId(state);

  if (action.playerId !== activePlayerId) {
    throw new Error(
      `Action from player "${action.playerId}" rejected: it is player "${activePlayerId}"'s turn`,
    );
  }

  switch (state.phase) {
    case "seeding":
      return applySeedingAction(state, action as SeedingAction);
    case "main":
      return applyMainAction(state, action as MainAction);
    case "ended":
      throw new Error('Cannot apply actions during "ended" phase');
  }
}
