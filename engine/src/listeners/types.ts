import type { Draft } from "immer";
import type { Card, GameEvent, MainAction, MainGameState, Reveals, StatName, UnitCard } from "../types";

export type { StatName };

/** Where the effect originates — enough to identify the source card. */
export interface EffectSource {
  type: "location" | "policy" | "passive_event" | "trap" | "item" | "unit";
  cardId: string;
  definitionId: string;
  /** Current controller of the source card. Bought / stolen cards report the
   *  new player here, so "is this mine?" checks in listener conditions
   *  follow the card's current side rather than its original drafter.
   *
   *  Undefined when nobody controls the source — a loose item on the grid is
   *  the only case today (see `item-helpers.ts:itemController`). This field is
   *  attribution only; nothing outside the effect factories reads it. */
  controllerId: string | undefined;
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


/** What a stat is being read *for*. The three cases are mutually exclusive —
 *  spelling them as a union rather than two independent optional fields is what
 *  stops a caller setting both, and lets `contextAndRoleMatch` switch
 *  exhaustively. `?: never` keeps every existing `ctx.contest?.role` reader
 *  working unchanged. */
export type StatOccasion =
  /** A stat contest — both the Attack action (`apply-main.ts:buildCombatantRoll`)
   *  and DSL stat contests (`executor.ts:executeContest`) set this. */
  | { contest: { role: "attacker" | "defender"; row: number; col: number }; mission?: never }
  /** A mission stat-sum check — set by `checkSingleRequirement`'s `"stat"` case. */
  | { contest?: never; mission: true }
  /** A bare read with no occasion (display, un-contextualised queries). */
  | { contest?: never; mission?: never };

export type StatQueryContext = {
  unit: UnitCard;
  stat: StatName;
  /** Grid position of the unit, if on grid. */
  position?: { row: number; col: number };
} & StatOccasion;

export interface CostQueryContext {
  card: Card;
  playerId: string;
  action: "buy" | "deploy";
  costIndex?: number;
}

export type ProtectionKind = "event_target" | "event_injury" | "contest_target";

/** `contestStat` is only meaningful for a contest, so it rides on that variant
 *  rather than being an optional field every kind carries.
 *
 *  Untouchable deliberately does not go through here — it needs the whole
 *  committed-attacker list, which a per-unit protection query can't supply, so
 *  it lives in `keyword-effects.ts:isAttackShielded` instead. */
export type ProtectionQueryContext = {
  unit: UnitCard;
  position: { row: number; col: number };
} & (
  | { kind: "contest_target"; contestStat: StatName }
  | { kind: "event_target" | "event_injury"; contestStat?: never }
);

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

/**
 * Returns this card's contribution to what `viewerId` is allowed to see.
 * Called fresh per visible-state build; should be side-effect free.
 */
export type RevealsProvider = (
  state: MainGameState,
  viewerId: string,
) => Partial<Reveals>;

/** Result of an effect factory — listeners, query listeners, and reveals. */
export interface EffectDefinition {
  listeners: EffectListener[];
  queries: QueryListener[];
  /** Optional: contributes to VisibleState.reveals when called per viewer. */
  reveals?: RevealsProvider;
}
