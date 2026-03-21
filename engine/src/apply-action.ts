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
  if (action.playerId !== state.turn.activePlayerId) {
    throw new Error(
      `Action from player "${action.playerId}" rejected: it is player "${state.turn.activePlayerId}"'s turn`,
    );
  }

  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    // Log the action
    draft.actionLog.push(action);

    switch (action.type) {
      case "pass":
        events.push({ type: "turn_ended", playerId: action.playerId });
        // Advance to next player
        advanceTurn(draft, events);
        break;

      // TODO: implement all action handlers
      default:
        throw new Error(`Action type "${action.type}" is not yet implemented`);
    }
  });

  return { state: nextState, events };
}

/** Advance to the next player's turn. Advances round when all players have gone. */
function advanceTurn(draft: GameState, events: GameEvent[]): void {
  const currentIndex = draft.turnOrder.indexOf(draft.turn.activePlayerId);
  if (currentIndex === -1) {
    throw new Error(
      `Active player "${draft.turn.activePlayerId}" not found in turnOrder ` +
      `[${draft.turnOrder.join(", ")}]`,
    );
  }
  const nextIndex = (currentIndex + 1) % draft.turnOrder.length;

  if (nextIndex === 0) {
    // All players have taken their turn — new round
    draft.turn.round += 1;
  }

  draft.turn.activePlayerId = draft.turnOrder[nextIndex];
  events.push({
    type: "turn_started",
    playerId: draft.turn.activePlayerId,
    round: draft.turn.round,
  });
}
