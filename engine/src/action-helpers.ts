import type { GameState, Action, VisibleState, PlayerState } from "./types";

/**
 * Complete a template action with real card IDs.
 * Actions like seed_keep and seed_split_prospect come from validActions
 * as templates with empty arrays — this fills them with a simple default choice.
 *
 * Returns the action unchanged if it doesn't need filling.
 */
export function fillAction(state: GameState | VisibleState, action: Action): Action {
  const player = "self" in state
    ? state.self
    : state.players.find((p) => p.id === action.playerId);
  if (!player) return action;

  switch (action.type) {
    case "seed_keep": {
      if (action.keepIds.length > 0) return action;
      const keepCount = getKeepExposeCount(state, player);
      return {
        ...action,
        keepIds: player.hand.slice(0, keepCount.keep).map((c) => c.id),
        exposeIds: player.hand.slice(keepCount.keep, keepCount.keep + keepCount.expose).map((c) => c.id),
      };
    }

    case "seed_split_prospect": {
      if (action.topHalf.length > 0) return action;
      const locations = player.marketDeck.filter((c) => c.type === "location");
      const half = Math.ceil(locations.length / 2);
      return {
        ...action,
        topHalf: locations.slice(0, half).map((c) => c.id),
        bottomHalf: locations.slice(half).map((c) => c.id),
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
  const config = state.config;
  const keepCount = typeof config.seed_keep === "number" ? config.seed_keep : 8;
  const exposeCount = typeof config.seed_expose === "number" ? config.seed_expose : 2;
  const total = player.hand.length;

  if (total < keepCount + exposeCount) {
    const adjustedKeep = Math.ceil(total * (keepCount / (keepCount + exposeCount)));
    return { keep: adjustedKeep, expose: total - adjustedKeep };
  }

  return { keep: keepCount, expose: exposeCount };
}
