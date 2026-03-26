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
  ownerId: string;
}

export interface UnitCard extends CardBase {
  type: "unit";
  strength: number;
  cunning: number;
  charisma: number;
  attributes: string[];
  injured: boolean;
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
}

export interface PassiveEventCard extends EventCardBase {
  subtype: "passive";
  duration: number;
}

/** A passive event that has been played and is actively tracking duration. */
export interface ActivePassiveEvent extends PassiveEventCard {
  /** Remaining turns. Set when played, decremented each end-of-turn. */
  remainingDuration: number;
}

export interface TrapEventCard extends EventCardBase {
  subtype: "trap";
  trigger: string;
}

export type EventCard = InstantEventCard | PassiveEventCard | TrapEventCard;

export interface PolicyCard extends CardBase {
  type: "policy";
  effect: string;
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

/** Redacted trap view for opponents — card contents hidden. */
export interface TrapView {
  targetId?: string;
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
  | "policy_selection";

export interface SeedingState {
  step: SeedingStep;
  /** Whose input is needed next during seeding. */
  currentPlayerId: string;
  middleArea: Card[];
  /** Index into turnOrder for whose turn it is to steal. */
  stealTurnIndex: number;
  /** Players who have submitted seed_keep this round. Reset at step entry. */
  keepSubmitted: string[];
}

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
  players: PlayerState[];
  grid: Grid;
  market: Card[];
  /** Serializable RNG state. Reconstruct generator with prand.mersenne.fromState(). */
  rngState: readonly number[];
  seed: string;
  actionLog: Action[];
  turnOrder: string[];
}

export interface SeedingGameState extends GameStateBase {
  phase: "seeding";
  seedingState: SeedingState;
}

export interface MainGameState extends GameStateBase {
  phase: "main";
  turn: TurnState;
}

export interface EndedGameState extends GameStateBase {
  phase: "ended";
  turn: TurnState;
  winner?: string;
  scores: Record<string, number>;
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
  | { type: "policy_select"; playerId: string };

export type MainAction =
  | { type: "deploy"; playerId: string; cardId: string }
  | { type: "buy"; playerId: string; cardId: string; costIndex?: number }
  | {
      type: "activate";
      playerId: string;
      cardId: string;
      actionName: string;
      targetId?: string;
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
  | { type: "pass"; playerId: string };

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

export type DeckInput =
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
        }
      >;
    };

// ---------------------------------------------------------------------------
// Events (output of applyAction)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "card_deployed"; playerId: string; cardId: string }
  | { type: "card_bought"; playerId: string; cardId: string; cost: number }
  | { type: "card_drawn"; playerId: string; count: number }
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
  | { type: "passive_expired"; playerId: string; cardId: string }
  | { type: "unit_healed"; playerId: string; unitId: string }
  // Seeding phase events
  | { type: "seed_cards_drawn"; playerId: string; count: number }
  | {
      type: "seed_kept";
      playerId: string;
      keptCount: number;
      exposedCount: number;
    }
  | { type: "seed_stolen"; playerId: string; cardId: string }
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
  winner?: string;
  scores?: Record<string, number>;
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
