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

  // A suspended combat hands its decision to the prompt's decider — for #166's
  // matchup assignment that is the **defender**, normally the *non-active*
  // player. This gate here already restricts the decider to `resolve_combat_round`;
  // `handleResolveCombatRound` then re-checks that the id matches the prompt.
  // `getValidActions` mirrors this by keying its combat offer off
  // `combatPrompt.playerId`. Every other action still requires the active player.
  const combatDecider: string | undefined =
    state.phase === "main" ? state.combatPrompt?.playerId : undefined;
  const isCombatDecider: boolean =
    action.type === "resolve_combat_round" && action.playerId === combatDecider;
  if (action.playerId !== activePlayerId && !isCombatDecider) {
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
