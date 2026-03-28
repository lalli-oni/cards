import type { Draft } from "immer";
import type { GameEvent, MainGameState } from "../types";

/** Where the effect originates — enough to identify the source card. */
export interface EffectSource {
  type: "location" | "policy" | "passive_event" | "trap" | "item";
  cardId: string;
  definitionId: string;
  ownerId: string;
  /** Grid position for location-bound effects. */
  position?: { row: number; col: number };
}

/**
 * Emits a game event — logs it AND fires matching listeners.
 * Passed to listener apply functions so their secondary effects
 * (e.g. unit_injured from a trap) also flow through the system.
 */
export type EmitFn = (event: GameEvent) => void;

/**
 * A registered effect listener.
 *
 * The listener is the sensor (detects the event), the card is the actor
 * (its effect definition runs via `apply`).
 */
export interface EffectListener {
  source: EffectSource;
  /** Which GameEvent type this listener reacts to. */
  on: GameEvent["type"];
  /** Return false to skip this listener. Evaluated against read-only state. */
  condition?: (state: MainGameState, event: GameEvent) => boolean;
  /** Mutate the Immer draft and/or emit secondary events. */
  apply: (draft: Draft<MainGameState>, event: GameEvent, emit: EmitFn) => void;
}
