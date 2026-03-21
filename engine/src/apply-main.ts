import { produce } from "immer";
import type { GameState, GameEvent, MainAction } from "./types";
import { advanceTurn } from "./state-helpers";

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export function applyMainAction(state: GameState, action: MainAction): ApplyResult {
  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    draft.actionLog.push(action);

    switch (action.type) {
      case "pass":
        events.push({ type: "turn_ended", playerId: action.playerId });
        advanceTurn(draft, events);
        break;

      // TODO: implement all main phase action handlers
      default:
        throw new Error(`Action type "${action.type}" is not yet implemented`);
    }
  });

  return { state: nextState, events };
}
