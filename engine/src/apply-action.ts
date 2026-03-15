import { produce } from "immer";
import type { GameState, Action, GameEvent } from "./types";

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Apply a player action to the game state.
 * Returns a new immutable state and a list of events describing what happened.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    // Log the action
    draft.actionLog.push(action);

    switch (action.type) {
      case "pass":
        // End current player's turn
        events.push({ type: "turn_ended", playerId: action.playerId });
        break;

      // TODO: implement all action handlers
      default:
        throw new Error(`Action type "${action.type}" is not yet implemented`);
    }
  });

  return { state: nextState, events };
}
