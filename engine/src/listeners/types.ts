import type { Draft } from "immer";
import type { Card, GameEvent, MainAction, MainGameState, UnitCard } from "../types";

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

// ---------------------------------------------------------------------------
// Event listeners (mutations)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Query listeners (pure — no mutation)
// ---------------------------------------------------------------------------

export type StatName = "strength" | "cunning" | "charisma";

export interface StatQueryContext {
  unit: UnitCard;
  stat: StatName;
  /** Grid position of the unit, if on grid. */
  position?: { row: number; col: number };
  /** Present when queried during combat. */
  combat?: { role: "attacker" | "defender"; row: number; col: number };
}

export interface CostQueryContext {
  card: Card;
  playerId: string;
  action: "buy" | "deploy";
  costIndex?: number;
}

export type ProtectionKind = "event_target" | "event_injury" | "contest_target";

export interface ProtectionQueryContext {
  unit: UnitCard;
  position: { row: number; col: number };
  kind: ProtectionKind;
  contestStat?: StatName;
}

export interface APQueryContext {
  action: MainAction;
  playerId: string;
}

export interface StatModifierListener {
  source: EffectSource;
  query: "stat";
  modify: (state: MainGameState, ctx: StatQueryContext) => number;
}

export interface CostModifierListener {
  source: EffectSource;
  query: "cost";
  modify: (state: MainGameState, ctx: CostQueryContext) => number;
  /** Minimum cost this modifier enforces. Highest min across active modifiers wins. */
  min?: number;
}

export interface ProtectionListener {
  source: EffectSource;
  query: "protection";
  isProtected: (state: MainGameState, ctx: ProtectionQueryContext) => boolean;
}

export interface APModifierListener {
  source: EffectSource;
  query: "ap";
  modify: (state: MainGameState, ctx: APQueryContext) => number;
}

export type QueryListener =
  | StatModifierListener
  | CostModifierListener
  | ProtectionListener
  | APModifierListener;

// ---------------------------------------------------------------------------
// Combined effect definition
// ---------------------------------------------------------------------------

/** Result of an effect factory — both event listeners and query listeners. */
export interface EffectDefinition {
  listeners: EffectListener[];
  queries: QueryListener[];
}
