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

  // TODO(#166): this gate rejects every non-active player, so it will reject a
  // defender-assigned `resolve_combat_round` (the defender is normally the
  // non-active player). When #166 hands the combat decision to the defender,
  // relax this to also admit the pending prompt's decider
  // (`state.combatPrompt?.playerId === action.playerId`), and mirror the
  // fall-through in `getValidActions`. Today decider == attacker == active, so
  // the paths agree and this is inert.
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
