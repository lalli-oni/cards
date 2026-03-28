import type { Draft } from "immer";
import type { GameEvent, MainGameState } from "../types";
import type { EffectListener } from "./types";

const MAX_EMIT_DEPTH = 10;

/**
 * Emit a game event: log it AND fire matching listeners.
 *
 * This is the single emission point for all game events during main-phase
 * action processing. It replaces direct `events.push()` calls.
 *
 * Listeners that produce secondary effects (e.g. a trap injuring a unit)
 * receive an emit callback, so their secondary events also flow through
 * the system and can trigger further listeners.
 *
 * A depth limit prevents infinite recursion from listener cycles.
 */
export function emit(
  draft: Draft<MainGameState>,
  event: GameEvent,
  listeners: EffectListener[],
  events: GameEvent[],
  depth = 0,
): void {
  if (depth >= MAX_EMIT_DEPTH) {
    throw new Error(`emit() recursion limit reached (${MAX_EMIT_DEPTH}). Possible listener cycle.`);
  }
  events.push(event);
  for (const listener of listeners) {
    if (listener.on !== event.type) continue;
    if (listener.condition && !listener.condition(draft as MainGameState, event)) continue;
    listener.apply(draft, event, (e) => emit(draft, e, listeners, events, depth + 1));
  }
}
