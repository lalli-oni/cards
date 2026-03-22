import { produce } from "immer";
import { advanceTurn } from "./state-helpers";
import type {
  ApplyResult,
  GameEvent,
  MainAction,
  MainGameState,
} from "./types";

export function applyMainAction(
  state: MainGameState,
  action: MainAction,
): ApplyResult {
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
