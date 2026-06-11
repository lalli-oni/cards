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
export type EventSubtype = "instant" | "passive" | "trap";

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
  keywords?: string[];
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

export interface StatModifier {
  stat: StatName;
  delta: number;
  /** Decremented at end of each turn. Removed when reaching 0. */
  remainingDuration: number;
  source: string;
}

export interface ControlOverride {
  previousOwnerId: string;
  remainingDuration: number;
}

export interface UnitCard extends CardBase {
  type: "unit";
  strength: number;
  cunning: number;
  charisma: number;
  attributes: string[];
  injured: boolean;
  actions?: ActionDef[];
  statModifiers?: StatModifier[];
  controlOverride?: ControlOverride;
}

export interface LocationCard extends CardBase {
  type: "location";
  edges: LocationEdges;
  requirements?: string;
  rewards?: string;
  passive?: string;
}

export interface ItemCard extends CardBase {
  type: "item";
  equip?: string;
  stored?: string;
  /** Unit this item is attached to (by card instance id). */
  equippedTo?: string;
}

interface EventCardBase extends CardBase {
  type: "event";
}

export interface InstantEventCard extends EventCardBase {
  subtype: "instant";
  effect?: string;
}

export interface PassiveEventCard extends EventCardBase {
  subtype: "passive";
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
  subtype: "trap";
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

export interface MainGameState extends GameStateBase {
  phase: "main";
  turn: TurnState;
  /**
   * Set by `peek(opponent + hand)` to surface opponent hand contents to the
   * active player. Cleared by `dismiss_view`. Main-phase only.
   *
   * Invariant: at most one of `pickPrompt` / `viewPrompt` is set at a time
   * (enforced by the executor's early-pause guard in `effect-dsl/executor.ts`
   * and asserted at the top of `applyMainAction`).
   */
  viewPrompt?: ViewPrompt;
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
  | DismissViewAction;

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
  | { type: "unit_injured"; unitId: string; ownerId: string }
  | { type: "unit_killed"; unitId: string; ownerId: string }
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
    }
  | {
      type: "market_replenished";
      playerId: string;
      cardId: string;
      slotIndex: number;
    }
  | { type: "card_discarded"; playerId: string; cardId: string; reason: string }
  | { type: "unit_buffed"; unitId: string; stat: StatName; delta: number; source: string }
  | { type: "cards_peeked"; playerId: string; cardIds: string[]; source: PickSource | ViewSource }
  | { type: "cards_picked"; playerId: string; cardIds: string[]; source: PickSource }
  | { type: "unit_controlled"; unitId: string; controllerId: string; previousOwnerId: string; duration: number }
  | { type: "contest_resolved"; stat: StatName; attackerId: string; defenderId: string; attackerPower: number; defenderPower: number; winnerId: string }
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
