import type { Action, GameState, PlayerState, VisibleState } from "./types";

/**
 * Complete a template action with real card IDs.
 * Actions like seed_keep come from validActions
 * as templates with empty arrays — this fills them with a simple default choice.
 *
 * Returns the action unchanged if it doesn't need filling.
 */
export function fillAction(
  state: GameState | VisibleState,
  action: Action,
): Action {
  let player: PlayerState | undefined;
  if ("self" in state) {
    // VisibleState only has full data for self — can't fill other players' actions
    if (state.playerId !== action.playerId) return action;
    player = state.self;
  } else {
    player = state.players.find((p) => p.id === action.playerId);
  }
  if (!player) return action;

  switch (action.type) {
    case "seed_keep": {
      if (action.keepIds.length > 0) return action;
      const { keep, expose } = getKeepExposeCount(state, player);
      return {
        ...action,
        keepIds: player.hand.slice(0, keep).map((c) => c.id),
        exposeIds: player.hand.slice(keep, keep + expose).map((c) => c.id),
      };
    }

    default:
      return action;
  }
}

function getKeepExposeCount(
  state: GameState | VisibleState,
  player: PlayerState,
): { keep: number; expose: number } {
  const keepCount =
    typeof state.config.seed_keep === "number" ? state.config.seed_keep : 8;
  const exposeCount =
    typeof state.config.seed_expose === "number" ? state.config.seed_expose : 2;
  const total = player.hand.length;

  if (total < keepCount + exposeCount) {
    const adjustedKeep = Math.ceil(
      total * (keepCount / (keepCount + exposeCount)),
    );
    return { keep: adjustedKeep, expose: total - adjustedKeep };
  }

  return { keep: keepCount, expose: exposeCount };
}
