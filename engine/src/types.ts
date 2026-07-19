import type { Attribute } from "./attributes";
import type { LocationType, EventType, ItemType } from "./card-categories";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Resolved variant config — plain key/value, no markdown. */
export type GameConfig = Record<string, number | string | boolean>;

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Input to createGame. */
export interface PlayerDescriptor {
  id: string;
  name: string;
  team?: string;
}

/** Runtime state for a single player. */
export interface PlayerState {
  id: string;
  name: string;
  team?: string;
  gold: number;
  vp: number;
  hand: Card[];
  seedingDeck: Card[];
  mainDeck: Card[];
  marketDeck: Card[];
  prospectDeck: Card[];
  discardPile: Card[];
  removedFromGame: Card[];
  hq: Card[];
  activePolicies: PolicyCard[];
  activeTraps: Trap[];
  /** Passive events currently in play, with remaining duration tracking. */
  passiveEvents: ActivePassiveEvent[];
  /** Policy cards available for selection during seeding. Not part of decks. */
  policyPool: PolicyCard[];
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type CardType = "unit" | "location" | "item" | "event" | "policy";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

// The named stats a unit card carries, contested/checked by mechanics.
export const STAT_NAMES = ["strength", "cunning", "charisma"] as const;
export type Stat = (typeof STAT_NAMES)[number];
export type EventTiming = "instant" | "passive" | "trap";

export interface GridPosition {
  row: number;
  col: number;
}

/** Edge state for location cards. */
export interface LocationEdges {
  n: boolean; // true = open, false = blocked
  e: boolean;
  s: boolean;
  w: boolean;
}

/** Shared fields for all card instances. */
interface CardBase {
  id: string;
  definitionId: string;
  name: string;
  cost: string;
  rarity: Rarity;
  text?: string;
  /** Mechanical keyword-effects (Lethal, Taunt, Fortified, …). Split out of
   *  the old `keywords` column in #119. Absent when the card has none. */
  keywords?: string[];
  /** Cross-type synergy vocabulary (`rules/attributes.md`). Shared across all
   *  card types; `UnitCard` narrows this to a required field. */
  attributes?: Attribute[];
  /** Seeding/creation origin. Immutable after the card is instantiated. */
  ownerId: string;
  /** Current in-game controller. Mutates on buy, seed-steal, and control effects. */
  controllerId: string;
}

export type StatName = "strength" | "cunning" | "charisma";

/**
 * An activatable action defined on a card.
 *
 * For unit and item cards, `effect` is a DSL string parsed by the executor
 * (e.g. `peek(opponent + hand)`). The library build script validates it
 * through `parseDSL`.
 *
 * For policy cards, `effect` is human-readable prose intended for UI display
 * (e.g. "Look at one opponent's hand."). The executable DSL is stored in
 * `engine/src/listeners/effects.ts:POLICY_ACTIONS`, keyed by the policy's
 * `definitionId`. The build script skips DSL validation for policy actions.
 */
export interface ActionDef {
  name: string;
  apCost: number;
  effect: string;
}

/** A named passive ability: a static/triggered effect a card has while in play,
 *  with no AP cost and no player activation (contrast ActionDef). `effect` is
 *  human-readable prose today — like a location's `passive` and policy action
 *  text — not executable DSL; the engine does not yet apply unit passives
 *  mechanically. Sourced from the CSV `passives` column (`name:effect`). */
export interface PassiveDef {
  name: string;
  effect: string;
}

/** Single source of truth for "what kind of card applied a modifier".
 *  Reused by `ModifierSource` (event payloads) and `EffectSource`
 *  (listener registrations). */
export type ModifierSourceType =
  | "location"
  | "policy"
  | "passive_event"
  | "event"
  | "trap"
  | "item"
  | "unit";

/** `cardId` is the instance id (two copies of the same card on the grid
 *  resolve distinctly); `definitionId` is the kebab-case identifier from
 *  the card library (not a human-facing display name). */
export interface ModifierSource {
  readonly type: ModifierSourceType;
  readonly cardId: string;
  readonly definitionId: string;
}

/** Construction-time invariant: `delta !== 0`. The breakdown builders
 *  filter zero-delta entries before push; manual constructors must too. */
export interface ModifierEntry {
  readonly source: ModifierSource;
  readonly delta: number;
}

/** Fields shared by combat and DSL-contest per-side payloads. */
export interface ResolutionSide {
  unitId: string;
  modifiers: ModifierEntry[];
  roll: number;
  /** base + Σmodifier deltas + roll. May not equal that sum when the
   *  underlying stat clamps to 0 — the clamp surfaces as a synthetic
   *  `definitionId: "clamped"` entry in `modifiers` so the displayed
   *  math reconciles. */
  power: number;
}

export interface CombatSide extends ResolutionSide {
  baseStrength: number;
  injuredBefore: boolean;
}

/**
 * Display-only unit info for a `retreat` prompt (#168). A retreat is offered
 * *before* the round rolls, so — unlike `CombatSide` — there is no roll or
 * power: just the identity, strength, and injured status the client needs to
 * list the units the deciding side would pull back to HQ. Modelling it as its
 * own type (rather than reusing `CombatSide` with `roll: 0` / `power: base`
 * placeholders) keeps the prompt from carrying fields that would lie about an
 * unrolled round.
 */
export interface RetreatUnitDisplay {
  unitId: string;
  strength: number;
  injured: boolean;
}

/** Mirrors `CombatSide` minus combat-specific fields. Contests do not
 *  apply an injury penalty today, so `injuredBefore` is omitted by
 *  design — a future debuff-aware contest can re-derive from the unit. */
export interface ContestSide extends ResolutionSide {
  baseStat: number;
}

/** Outcome of one combat pair. Exported so the client can reference the
 *  same literal union instead of redeclaring it. */
export type CombatPairOutcome =
  | "kill_attacker"
  | "kill_defender"
  | "injure_attacker"
  | "injure_defender"
  | "tie";

export interface StatModifier {
  stat: StatName;
  delta: number;
  /** Decremented at end of each turn. Removed when reaching 0. */
  remainingDuration: number;
  source: ModifierSource;
}

export interface ControlOverride {
  /** The controllerId in effect before this `control` cast was applied.
   *  Restored when the override duration drains. Naming this "controller"
   *  rather than "owner" lets the field hold the right semantics for
   *  nested controls and stolen-then-controlled units. */
  previousControllerId: string;
  remainingDuration: number;
}

export interface UnitCard extends CardBase {
  type: "unit";
  strength: number;
  cunning: number;
  charisma: number;
  attributes: Attribute[];
  injured: boolean;
  actions?: ActionDef[];
  /** Named passive abilities (e.g. Genghis Khan's "Horselord"). Display-only
   *  today — see PassiveDef. Present as an empty array (not absent) when the
   *  card has none: the build emits `passives: []` and the loader's
   *  `?? undefined` is a no-op for `[]`, matching `actions`. */
  passives?: PassiveDef[];
  statModifiers?: StatModifier[];
  controlOverride?: ControlOverride;
}

export interface LocationCard extends CardBase {
  type: "location";
  edges: LocationEdges;
  requirements?: string;
  rewards?: string;
  /** A single unnamed passive as prose. Note the asymmetry with
   *  `UnitCard.passives` (a named, structured `PassiveDef[]`): the same "passive
   *  ability" concept has two shapes across card types today, by design/scope. */
  passive?: string;
  /** Per-type category (Palace, Archive, Arena, …). Flavor-only today; see #160.
   *  From the CSV `location_type` column (renamed to camelCase in-engine). */
  locationType?: LocationType;
}

export interface ItemCard extends CardBase {
  type: "item";
  equip?: string;
  stored?: string;
  /** Unit this item is attached to (by card instance id). */
  equippedTo?: string;
  /** Multi-value item category (Weapon, Armor, Tool, Artifact, Banner, Regalia).
   *  Named `itemType` to avoid colliding with the `type` discriminant. The
   *  militarist policy discount keys off this (see effects.ts). */
  itemType?: ItemType[];
  /** Activatable actions (e.g. Philosopher's Stone's `transmute`). Enumerated
   *  by `getValidActions` and run by `handleActivate` only when a controlling
   *  unit is co-located with the item (items are operated by units). */
  actions?: ActionDef[];
}

interface EventCardBase extends CardBase {
  type: "event";
  /** Per-type category (Catastrophe, Prosperity). Flavor-only today; see #160.
   *  From the CSV `event_type` column (renamed to camelCase in-engine). */
  eventType?: EventType;
}

export interface InstantEventCard extends EventCardBase {
  timing: "instant";
  effect?: string;
}

export interface PassiveEventCard extends EventCardBase {
  timing: "passive";
  duration: number;
}

/** A passive event that has been played and is actively tracking duration. */
export interface ActivePassiveEvent extends PassiveEventCard {
  /** Remaining turns. Set when played, decremented each end-of-turn. */
  remainingDuration: number;
  /** Target card instance id (e.g. a location for Plague). */
  targetId?: string;
}

export interface TrapEventCard extends EventCardBase {
  timing: "trap";
  trigger: string;
}

export type EventCard = InstantEventCard | PassiveEventCard | TrapEventCard;

export interface PolicyCard extends CardBase {
  type: "policy";
  effect: string;
  /** UI-only action descriptions — `ActionDef.effect` is human-readable here. */
  actions?: ActionDef[];
}

export type Card = UnitCard | LocationCard | ItemCard | EventCard | PolicyCard;

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface GridCell {
  location: LocationCard | null;
  units: UnitCard[];
  items: ItemCard[];
}

export interface Trap {
  card: TrapEventCard;
  /** Instance id of the targeted card (location, unit, or item), if any. */
  targetId?: string;
}

/** Redacted trap view for opponents — card contents hidden unless revealed (e.g. by Spy Glass). */
export interface TrapView {
  targetId?: string;
  /** Card-instance id of the trap (always present so revealers can look it up). */
  cardId: string;
  /** Trap card contents — only populated when the viewer has reveal rights for this trap. */
  card?: TrapEventCard;
}

export type Grid = GridCell[][];

// ---------------------------------------------------------------------------
// Phases & Turns
// ---------------------------------------------------------------------------

export type Phase = "seeding" | "main" | "ended";

export type DeckName = "main" | "market" | "prospect" | "seeding";

/** Each seeding step maps 1:1 to the action the active player must submit. */
export type SeedingStep =
  | "seed_draw"
  | "seed_keep"
  | "seed_steal"
  | "seed_place_location"
  | "policy_selection"
  /** Post-policy reorder pass for cards like Scholar that reorder owner's main deck. */
  | "post_policy_pick";

interface SeedingStateBase {
  /** Whose input is needed next during seeding. */
  currentPlayerId: string;
  middleArea: Card[];
  /** Index into players array for whose turn it is to steal. */
  stealTurnIndex: number;
  /** Players who have submitted seed_keep this round. Reset at step entry. */
  keepSubmitted: string[];
}

/**
 * Seeding state. The `pendingPostPolicyPicks` field exists only on the
 * `post_policy_pick` variant — keeping `step` and the queue in lockstep
 * makes the two illegal combinations (`post_policy_pick` with no queue,
 * other steps with a non-empty queue) unrepresentable.
 *
 * Order matters: the queue is populated in turn order so multi-player
 * Scholar games drain deterministically (player 0 reorders first, then
 * player 1, etc.). Independent of game outcome.
 */
export type SeedingState =
  | (SeedingStateBase & {
      step: Exclude<SeedingStep, "post_policy_pick">;
    })
  | (SeedingStateBase & {
      step: "post_policy_pick";
      pendingPostPolicyPicks: readonly [string, ...string[]];
    });

export interface TurnState {
  activePlayerId: string;
  actionPointsRemaining: number;
  round: number;
}

// ---------------------------------------------------------------------------
// Game State (discriminated union on phase)
// ---------------------------------------------------------------------------

interface GameStateBase {
  config: GameConfig;
  /** Player states, ordered by turn. Array index determines turn order; there is no separate turnOrder field. */
  players: PlayerState[];
  grid: Grid;
  market: Card[];
  /** Serializable RNG state. Reconstruct generator with `fromState()` from `./rng`. */
  rngState: readonly number[];
  seed: string;
  actionLog: Action[];
  /**
   * Set when an effect or passive needs player input. Cleared by `resolve_pick`.
   * Lives on the base so seeding-time prompts (e.g. Scholar's reorder) can use
   * the same surface as main-phase `pick` verbs.
   */
  pickPrompt?: PickPrompt;
}

export interface SeedingGameState extends GameStateBase {
  phase: "seeding";
  seedingState: SeedingState;
}

/**
 * Origin zone for the cards in a `PickPrompt`. Extend the union when new
 * sources are added (e.g. market, discard) so consumers stay exhaustive.
 */
export type PickSource = "main_deck";

/**
 * Fields shared by every `PickPrompt` variant.
 *
 * Lives on `GameStateBase.pickPrompt` (so it surfaces in main and seeding
 * phases) and on `VisibleState.pickPrompt` (only populated when the viewer
 * is the picker). Used both mid-effect during main and during the
 * `post_policy_pick` seeding step.
 */
interface PickPromptBase {
  playerId: string;
  /** Card instance IDs the player may pick from, in revealed order. Always non-empty. Items are unique (instance ids). */
  options: readonly [string, ...string[]];
  source: PickSource;
}

/**
 * A prompt asking the player to pick from a set of revealed cards.
 *
 * Discriminated on `kind`:
 *
 * - `"deck_pick"`: the picker chooses a `count`-sized subset of `options`;
 *   order does not matter. `1 <= count < options.length` (the DSL validator
 *   enforces `count >= 1` at parse time; `execPick` auto-picks instead of
 *   suspending when `count >= peeked.length`).
 * - `"scholar_reorder"`: the picker submits a permutation of `options` (all
 *   of them, in chosen order). `count` is implicitly `options.length` and
 *   not stored on the variant. The submission order is the outcome.
 */
export type PickPrompt =
  | (PickPromptBase & { kind: "deck_pick"; count: number })
  | (PickPromptBase & { kind: "scholar_reorder" });

/**
 * Origin of a `ViewPrompt`. Extend the union when new private-view sources are
 * added (e.g. `opponent_deck`) so consumers stay exhaustive.
 */
export type ViewSource = "opponent_hand";

/**
 * Set when a `peek(opponent + hand)` effect runs. Pauses the active player
 * until they submit `dismiss_view`. Stores full `Card[]` (not ids) because
 * `getVisibleState` redacts opponent hands to `handSize` — the viewer has no
 * other way to resolve ids back into card data on the client. Filtered on
 * `VisibleState.viewPrompt` so only the viewer sees the contents.
 *
 * Today the selector picks the first non-active player deterministically;
 * multi-opponent target selection (matching the card text "target opponent's
 * hand") is not yet implemented.
 */
export interface ViewPrompt {
  /** Who is viewing (the active player who triggered the effect). */
  playerId: string;
  /**
   * Opponent hand contents captured when the peek fired. Shallow-cloned at
   * peek time — under immer's structural sharing, mutations after peek do not
   * propagate, so this acts as a snapshot in practice.
   */
  cards: Card[];
  source: ViewSource;
  /** Whose hand is shown (for UI labelling). */
  sourcePlayerId: string;
}

/**
 * Resumable loop state for `runCombat`, shared by both callers: the fresh
 * round-0 run from `handleAttack` and every `resolve_combat_round` resume of a
 * suspended fight. Stores the durable handle needed to pick a fight back up:
 * which cell, the two sides' committed unit instance ids, and the round index to
 * run. Living combatants are recomputed from the cell each round (units may have
 * been killed/injured), so only the *committed* id lists are stored — not live
 * unit references, which cannot survive the `produce()` boundary between suspend
 * and resume.
 *
 * `CombatPrompt` extends this with the suspended-decision context (revealed
 * rolls + decider); `runCombat` itself consumes only the fields here, so the
 * loop structurally cannot depend on prompt-only data.
 */
export interface CombatLoopState {
  row: number;
  col: number;
  /** Attacking player id (the one who issued `attack`). */
  attackerId: string;
  /** Defending player id. */
  defenderId: string;
  /** Round index to run (0-based; `combat_round_cap` bounds it). */
  round: number;
  /** Committed attacker unit instance ids (never mutated after suspend). */
  attackerUnitIds: readonly string[];
  /** Committed defender unit instance ids (never mutated after suspend). */
  defenderUnitIds: readonly string[];
}

/**
 * A combat suspended awaiting a player decision. The `sit_out` / `assign_matchups`
 * decisions land *within* a round (README.md Combat step 4 — Matchup) — after the
 * step-3 roll, before resolution — carrying that round's revealed rolls inline; a
 * single such round can suspend twice (`kind` transitions): a `sit_out` prompt
 * first (larger side drops its excess), then, if `min >= 2` participants remain,
 * an `assign_matchups` prompt. `retreat` is the exception: it is raised at a round
 * *boundary* **before** the roll, so it carries no rolls (see `retreatUnits`).
 *
 * `kind` discriminates the decisions:
 * - `"retreat"` (#168): raised at a round boundary (round >= 1) **before** the
 *   roll — the attacker decides first, then, if it stays, the defender.
 *   `playerId` is the deciding side's owner. The round is unrolled, so `atkRolls`
 *   / `defRolls` are **empty**; the deciding side's remaining committed units are
 *   carried in `retreatUnits` (identity + strength + injured, no dice). All-or-
 *   nothing: the decider withdraws its whole side or stays.
 * - `"sit_out"` (#167): the larger side removes `max - min` excess units.
 *   `playerId` is the **larger side's** owner (attacker or defender), and
 *   `atkRolls` / `defRolls` are the *full* living rolls — so the lists have
 *   **unequal** length (that is what makes the choice exist).
 * - `"assign_matchups"` (#166): the defender pairs the participants. `playerId`
 *   is the **defender**, and `atkRolls` / `defRolls` are the equal-length
 *   participant lists (post sit-out), a bijection to assign between them.
 *
 * `playerId` is who must submit `resolve_combat_round`. It may be the *non-active*
 * player (always so for `assign_matchups`), so the active-player gate in
 * `apply-action.ts` admits the prompt's decider as a special case.
 *
 * Plain `CombatSide` data (no live unit refs) so it survives the `produce()`
 * suspend boundary.
 */
export interface CombatPrompt extends CombatLoopState {
  /** Which decision this suspend is awaiting (see type doc). */
  kind: CombatDecision["kind"];
  /** Player expected to submit `resolve_combat_round`. */
  playerId: string;
  /** Revealed rolls of the attacker units for `round` (full living set for
   *  `sit_out`; equal-length participants for `assign_matchups`). **Empty for
   *  `retreat`** — that decision is pre-roll; see `retreatUnits`. */
  atkRolls: readonly CombatSide[];
  /** Revealed rolls of the defender units for `round` (see `atkRolls`). */
  defRolls: readonly CombatSide[];
  /** For a `retreat` prompt only: the deciding side's remaining committed units
   *  (injured included), for the client to list. Absent for `sit_out` /
   *  `assign_matchups`. The round is unrolled at a retreat offer, so these carry
   *  no roll/power (see `RetreatUnitDisplay`). */
  retreatUnits?: readonly RetreatUnitDisplay[];
}

export interface MainGameState extends GameStateBase {
  phase: "main";
  turn: TurnState;
  /**
   * Set by `peek(opponent + hand)` to surface opponent hand contents to the
   * active player. Cleared by `dismiss_view`. Main-phase only.
   *
   * Invariant: at most one of `pickPrompt` / `viewPrompt` / `combatPrompt` is
   * set at a time (enforced by the executor's early-pause guard in
   * `effect-dsl/executor.ts` and asserted at the top of `applyMainAction`).
   */
  viewPrompt?: ViewPrompt;
  /**
   * Set when combat suspends for a player decision (matchup, sit-out, or
   * retreat), cleared by `resolve_combat_round`. Main-phase only — placed here (not on
   * `GameStateBase`) so a seeding or ended state cannot structurally carry one,
   * mirroring `viewPrompt`. The prompt carries the full resumable loop state
   * inline — the same Option-A pattern `pickPrompt`/`viewPrompt` use.
   *
   * Live as of #166: combat pauses whenever the defender has a real pairing
   * choice (`matchupDecisionPending` in `apply-main.ts`). #167 added the sit-out
   * pause (larger side drops excess units); #168 added the per-round retreat
   * pause, raised before each round >= 1 rolls (attacker then defender).
   */
  combatPrompt?: CombatPrompt;
}

export interface EndedGameState extends GameStateBase {
  phase: "ended";
  turn: TurnState;
  winner?: string;
  scores: Record<string, number>;
  /** Ended games never carry a pending pick — make that compile-time. */
  pickPrompt?: never;
  /** Ended games never carry a pending view either. */
  viewPrompt?: never;
  /** Ended games never carry a suspended combat either. */
  combatPrompt?: never;
}

export type GameState = SeedingGameState | MainGameState | EndedGameState;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the active player ID regardless of phase. */
export function getActivePlayerId(state: GameState): string {
  switch (state.phase) {
    case "seeding":
      return state.seedingState.currentPlayerId;
    case "main":
      return state.turn.activePlayerId;
    case "ended":
      throw new Error("No active player in ended phase");
  }
}

/**
 * The player who must resolve a suspended combat (the defender / matchup
 * decider), or `undefined` when no combat is suspended. Single-sources the
 * "decider is `combatPrompt.playerId`" invariant shared by the dispatch gate
 * (`apply-action.ts`) and the turn loop (`controller.ts`).
 */
export function getDeciderId(state: GameState): string | undefined {
  return state.phase === "main" ? state.combatPrompt?.playerId : undefined;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SeedingAction =
  | { type: "seed_draw"; playerId: string }
  | {
      type: "seed_keep";
      playerId: string;
      keepIds: string[];
      exposeIds: string[];
    }
  | {
      type: "seed_steal";
      playerId: string;
      cardId: string;
      row?: number;
      col?: number;
      rotation?: number;
    }
  | {
      type: "seed_place_location";
      playerId: string;
      row: number;
      col: number;
      rotation?: number;
    }
  | { type: "policy_select"; playerId: string }
  | ResolvePickAction;

/**
 * Submitted by the picker to resolve a pending `pickPrompt`. Valid in both
 * main and seeding phases (during `post_policy_pick`); the dispatcher routes
 * by phase. `pickedCardIds` must be non-empty.
 */
export interface ResolvePickAction {
  type: "resolve_pick";
  playerId: string;
  pickedCardIds: [string, ...string[]];
}

export type MainAction =
  | { type: "deploy"; playerId: string; cardId: string }
  | { type: "buy"; playerId: string; cardId: string; costIndex?: number }
  | {
      type: "activate";
      playerId: string;
      cardId: string;
      actionName: string;
      targetId?: string;
      targetCell?: GridPosition;
    }
  | { type: "draw"; playerId: string }
  | {
      type: "enter";
      playerId: string;
      unitId: string;
      row: number;
      col: number;
    }
  | { type: "move"; playerId: string; unitId: string; row: number; col: number }
  | { type: "play_event"; playerId: string; cardId: string; targetId?: string }
  | { type: "equip"; playerId: string; itemId: string; unitId: string }
  | { type: "destroy"; playerId: string; cardId: string }
  | {
      type: "raze";
      playerId: string;
      unitId: string;
      row: number;
      col: number;
      rotation?: number;
    }
  | {
      type: "attack";
      playerId: string;
      /** At least one attacker required. */
      unitIds: [string, ...string[]];
      row: number;
      col: number;
    }
  | { type: "attempt_mission"; playerId: string; row: number; col: number }
  | { type: "pass"; playerId: string }
  | ResolvePickAction
  | DismissViewAction
  | ResolveCombatRoundAction;

/**
 * Submitted by the viewer to dismiss a pending `viewPrompt`. The view is
 * read-only (no outcome to feed downstream), so the engine just clears the
 * prompt and resumes normal play. AP is not refunded (already spent on the
 * activating action).
 */
export interface DismissViewAction {
  type: "dismiss_view";
  playerId: string;
}

/**
 * One matchup the defender assigns: attacker unit `attackerUnitId` fights
 * defender unit `defenderUnitId`. Both ids must appear in the pending prompt's
 * `atkRolls` / `defRolls` (the participating units), each used exactly once.
 */
export interface CombatMatchup {
  attackerUnitId: string;
  defenderUnitId: string;
}

/**
 * The defender's decision when resuming a combat suspended for matchup
 * assignment (#166). Modeled as a discriminated `kind` sub-union (mirroring
 * `PickPrompt`'s split) so the sit-out (#167) and retreat (#168) payloads slot
 * in later without a flat bag of optional fields — a retreat payload cannot then
 * structurally carry matchup data.
 */
export type CombatDecision =
  | {
      kind: "assign_matchups";
      /** A bijection over the prompt's participating units; length = min(sides). */
      pairs: readonly CombatMatchup[];
    }
  | {
      kind: "sit_out";
      /**
       * The excess units the larger side removes this round (#167). Length must
       * equal `max(sides) - min(sides)`, and every id must be on the larger side
       * (the prompt's longer roll list). Removing them leaves equal-length
       * participants, which then either auto-resolve or trigger a matchup
       * decision (the 3v2 double-suspend case).
       */
      sitOutUnitIds: readonly string[];
    }
  | {
      kind: "retreat";
      /**
       * Per-round retreat (#168), all-or-nothing for the deciding side (the
       * prompt's `playerId`). `true` withdraws *every* remaining committed unit
       * of that side to its owner's HQ and ends its part in the combat (the other
       * side wins if it still holds the cell); `false` stays and fights the round.
       * Raised at a round boundary *before* the roll — the attacker decides first,
       * then, if it stays, the defender.
       */
      retreat: boolean;
    };

/**
 * Submitted to resume a combat suspended for a player decision (pending
 * `combatPrompt`). Carries the discriminated `decision`. AP is not spent here
 * (already spent on the initiating `attack`).
 */
export interface ResolveCombatRoundAction {
  type: "resolve_combat_round";
  playerId: string;
  decision: CombatDecision;
}

export type Action = SeedingAction | MainAction;

/** Maps a GameState subtype to its valid action type. */
export type ActionForState<S extends GameState> =
  S extends SeedingGameState
    ? SeedingAction
    : S extends MainGameState
      ? MainAction
      : never;

// ---------------------------------------------------------------------------
// Apply Result
// ---------------------------------------------------------------------------

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Deck Input (for createGame)
// ---------------------------------------------------------------------------

export type SetupInput =
  | {
      mode: "seeding";
      decks: Record<string, { seedingDeck: Card[]; policyPool: PolicyCard[] }>;
    }
  | {
      mode: "main";
      decks: Record<
        string,
        {
          mainDeck: Card[];
          hand: Card[];
          prospectDeck: Card[];
          marketDeck: Card[];
          activePolicies: PolicyCard[];
          /** Override starting_gold from config for this player. */
          gold?: number;
        }
      >;
      /** Pre-populated grid. When omitted, an empty grid is created. */
      grid?: Grid;
      /** Pre-populated shared market. When omitted, starts empty. */
      market?: Card[];
    };

// ---------------------------------------------------------------------------
// Events (output of applyAction)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "card_deployed"; playerId: string; cardId: string }
  | {
      type: "card_bought";
      playerId: string;
      cardId: string;
      /** Carried inline because the bought card moves into the buyer's hand,
       *  which is redacted in OpponentView — the renderer can't resolve
       *  `cardId` from another viewer's perspective. Mirrors `trap_triggered`. */
      cardName: string;
      cost: number;
    }
  | {
      type: "card_drawn";
      playerId: string;
      count: number;
      /** Identity of the drawn card. Present in the god-view stream emitted
       *  by the engine; `getVisibleEvent` strips it for viewers other than
       *  the drawer so own-deck-top knowledge does not leak. Absence at the
       *  renderer therefore means "this draw belongs to someone else". */
      cardId?: string;
    }
  | {
      type: "unit_entered";
      playerId: string;
      unitId: string;
      row: number;
      col: number;
    }
  | {
      type: "unit_moved";
      playerId: string;
      unitId: string;
      fromRow: number;
      fromCol: number;
      toRow: number;
      toCol: number;
    }
  | { type: "unit_injured"; unitId: string; controllerId: string }
  | { type: "unit_killed"; unitId: string; controllerId: string }
  | { type: "event_played"; playerId: string; cardId: string }
  | { type: "trap_set"; playerId: string; cardId: string; targetId?: string }
  | {
      type: "trap_triggered";
      playerId: string;
      cardId: string;
      /** Carried inline because the trap card moves out of OpponentView once
       *  discarded — the renderer can't resolve it from id alone. */
      cardName: string;
      targetId?: string;
    }
  | { type: "item_equipped"; playerId: string; itemId: string; unitId: string }
  | { type: "item_dropped"; itemId: string; row: number; col: number }
  | { type: "location_placed"; row: number; col: number; cardId: string }
  | { type: "location_razed"; row: number; col: number; cardId: string }
  | {
      type: "mission_completed";
      playerId: string;
      locationId: string;
      vp: number;
    }
  | {
      type: "mission_attempt_failed";
      playerId: string;
      row: number;
      col: number;
      locationId: string;
    }
  | { type: "gold_changed"; playerId: string; amount: number; reason: string }
  | { type: "turn_started"; playerId: string; round: number }
  | { type: "turn_ended"; playerId: string }
  | { type: "phase_changed"; from: Phase; to: Phase }
  | { type: "game_ended"; winner?: string; scores: Record<string, number> }
  | { type: "deck_shuffled"; playerId: string; deck: DeckName }
  | { type: "card_destroyed"; playerId: string; cardId: string }
  | {
      type: "card_activated";
      playerId: string;
      cardId: string;
      /** Carried inline because the card may be destroyed during its own
       *  action (e.g. Ramesses' `monument: kill(self)`), after which the
       *  renderer can't resolve `cardId`. Mirrors `trap_triggered`. */
      cardName: string;
      actionName: string;
      /** Tagged so that "no target", "card target", and "cell target" are
       *  the only representable states — `{ targetId, targetCell }` together
       *  would be ambiguous and is no longer expressible. */
      target?:
        | { kind: "card"; id: string }
        | { kind: "cell"; row: number; col: number };
    }
  | {
      type: "combat_started";
      row: number;
      col: number;
      attackerId: string;
      defenderId: string;
    }
  | {
      type: "combat_resolved";
      row: number;
      col: number;
      winnerId: string | null;
      /** The two sides, so the event log can categorize the conclusion with the
       *  rest of the fight (a bare `winnerId` — null on a draw — otherwise makes
       *  it uncategorizable and it falls through to a hidden "system" row). */
      attackerId: string;
      defenderId: string;
    }
  | {
      /** A side withdrew its whole remaining committed force to HQ before a
       *  round rolled (#168). Emitted just before the withdrawal and the
       *  ensuing `combat_resolved`, so the result dialog can name the retreat. */
      type: "combat_retreated";
      row: number;
      col: number;
      /** The side (player id) that retreated. */
      playerId: string;
    }
  | {
      type: "combat_pair_resolved";
      row: number;
      col: number;
      /** Player ids — categorizers route by these. Distinct from
       *  `attacker.unitId` / `defender.unitId` (the unit instance ids). */
      attackerPlayerId: string;
      defenderPlayerId: string;
      attacker: CombatSide;
      defender: CombatSide;
      outcome: CombatPairOutcome;
    }
  | {
      type: "market_replenished";
      playerId: string;
      cardId: string;
      slotIndex: number;
    }
  | { type: "card_discarded"; playerId: string; cardId: string; reason: string }
  | { type: "unit_buffed"; unitId: string; stat: StatName; delta: number; source: ModifierSource }
  | { type: "cards_peeked"; playerId: string; cardIds: string[]; source: PickSource | ViewSource }
  | { type: "cards_picked"; playerId: string; cardIds: string[]; source: PickSource }
  | { type: "unit_controlled"; unitId: string; controllerId: string; previousControllerId: string; duration: number }
  | {
      type: "contest_resolved";
      stat: StatName;
      /** Player id who initiated the contest (the activator). Distinct
       *  from `attackerId` (a unit instance id). */
      casterPlayerId: string;
      attackerId: string;
      defenderId: string;
      attacker: ContestSide;
      defender: ContestSide;
      winnerId: string;
    }
  | { type: "passive_expired"; playerId: string; cardId: string }
  | { type: "unit_healed"; playerId: string; unitId: string }
  // Seeding phase events
  | { type: "seed_cards_drawn"; playerId: string; count: number }
  | {
      type: "seed_kept";
      playerId: string;
      keptCount: number;
      exposedCount: number;
      toProspect: number;
      toMarket: number;
    }
  | {
      type: "seed_stolen";
      playerId: string;
      cardId: string;
      destination: "grid" | "prospect" | "market";
    }
  | { type: "seeding_step_changed"; step: SeedingStep }
  | {
      type: "seeding_player_changed";
      playerId: string;
      step: SeedingStep;
    }
  | { type: "prospect_deck_built"; playerId: string }
  | { type: "deck_constructed"; playerId: string }
  | { type: "policies_assigned"; playerId: string; policyIds: string[] };

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Conditional information surfaced to a specific viewer by active card
 * passives — e.g. Alexandria Harbor lets its owner see the top of their
 * main deck; Spy Glass un-redacts specific opponent trap cards.
 *
 * Computed fresh by walking the same card surfaces as `rebuildListeners`
 * (locations, items, units, policies, passive events, traps, HQ cards)
 * each time the visible state is built. Each card's effect factory may
 * return a `reveals` provider (separate from the `listeners`/`queries`
 * surface) that contributes to this object.
 */
export interface Reveals {
  /** Top card of viewer's own main deck (Alexandria Harbor and similar). */
  mainDeckTop?: Card;
  /**
   * Opponent trap card-instance ids the viewer is allowed to see
   * un-redacted. Always deduplicated (set semantics, list representation
   * for JSON serialization). Set by `computeReveals` via a `Set` and
   * converted to an array at return.
   */
  revealedTrapIds: string[];
}

/** Filtered game state for a specific player. Hidden info is omitted. */
export interface VisibleState {
  config: GameConfig;
  phase: Phase;
  /** Present during main and ended phases. */
  turn?: TurnState;
  /** Always populated — the player whose input is needed. */
  currentPlayerId: string;
  playerId: string;
  /** Full state for this player. */
  self: PlayerState;
  /** Teammates with full visibility. Empty if no team or solo. */
  teammates: PlayerState[];
  /** Opponent info with hidden cards replaced by counts. */
  opponents: OpponentView[];
  grid: Grid;
  market: Card[];
  turnOrder: string[];
  /** Shared middle area during seed rounds (face-up cards). */
  middleArea: Card[];
  /** Current seeding step, if in seeding phase. */
  seedingStep?: SeedingStep;
  /** Set during main or seeding phase when this viewer is the picker. */
  pickPrompt?: PickPrompt;
  /** Set during main phase when this viewer is the active player on a `peek(opponent + hand)`. */
  viewPrompt?: ViewPrompt;
  /** Set when combat is suspended mid-round for the defender's matchup decision. Public — combat is fully open, so surfaced to every viewer unredacted. */
  combatPrompt?: CombatPrompt;
  winner?: string;
  scores?: Record<string, number>;
  /** Conditional reveals granted by active passives for this viewer. */
  reveals: Reveals;
}

export interface OpponentView {
  id: string;
  name: string;
  team?: string;
  gold: number;
  vp: number;
  handSize: number;
  seedingDeckSize: number;
  mainDeckSize: number;
  marketDeckSize: number;
  prospectDeckSize: number;
  discardPileSize: number;
  hq: Card[];
  activePolicies: PolicyCard[];
  /** Traps are visible (face-down) but card contents are hidden. */
  activeTraps: TrapView[];
  /** Public — both players can see what passive events are in play. */
  passiveEvents: ActivePassiveEvent[];
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  version: string;
  config: GameConfig;
  players: PlayerDescriptor[];
  seed: string;
  actions: Action[];
  /** Optional snapshot for quick resume. Fully JSON-serializable. */
  snapshot?: GameState;
  result?: {
    winner?: string;
    scores: Record<string, number>;
    rounds: number;
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export interface PlayerAdapter {
  chooseAction(
    visibleState: VisibleState,
    validActions: Action[],
  ): Promise<Action>;
}
