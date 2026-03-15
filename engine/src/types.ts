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
  mainDeck: Card[];
  marketDeck: Card[];
  prospectDeck: Card[];
  discardPile: Card[];
  removedFromGame: Card[];
  hq: Card[];
  activePolicies: PolicyCard[];
  activeTraps: Trap[];
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
  mission?: string;
  passive?: string;
}

export interface ItemCard extends CardBase {
  type: "item";
  equip?: string;
  stored?: string;
  /** Unit this item is attached to (by card instance id). */
  equippedTo?: string;
}

export interface EventCard extends CardBase {
  type: "event";
  subtype: EventSubtype;
  duration?: number;
  trigger?: string;
  /** Remaining turns for passive events. */
  remainingDuration?: number;
}

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
  card: EventCard;
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

export interface TurnState {
  activePlayerId: string;
  actionPointsRemaining: number;
  round: number;
}

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------

export interface GameState {
  config: GameConfig;
  phase: Phase;
  turn: TurnState;
  players: PlayerState[];
  grid: Grid;
  market: Card[];
  /** Serializable RNG state. Reconstruct generator with prand.mersenne.fromState(). */
  rngState: readonly number[];
  seed: string;
  actionLog: Action[];
  turnOrder: string[];
  winner?: string;
  scores?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "deploy"; playerId: string; cardId: string }
  | { type: "buy"; playerId: string; cardId: string; costIndex?: number }
  | { type: "activate"; playerId: string; cardId: string; actionName: string; targetId?: string }
  | { type: "draw"; playerId: string }
  | { type: "enter"; playerId: string; unitId: string; row: number; col: number }
  | { type: "move"; playerId: string; unitId: string; row: number; col: number }
  | { type: "play_event"; playerId: string; cardId: string; targetId?: string }
  | { type: "equip"; playerId: string; itemId: string; unitId: string }
  | { type: "destroy"; playerId: string; cardId: string }
  | { type: "raze"; playerId: string; unitId: string; row: number; col: number }
  | { type: "pass"; playerId: string }
  // Seeding phase actions
  | { type: "seed_keep"; playerId: string; keepIds: string[]; exposeIds: string[] }
  | { type: "seed_steal"; playerId: string; cardId: string; row?: number; col?: number; rotation?: number }
  | { type: "seed_place_location"; playerId: string; cardId: string; row: number; col: number; rotation?: number }
  | { type: "policy_pass"; playerId: string; policyIds: string[]; toPlayerId: string }
  | { type: "policy_pick"; playerId: string; policyId: string };

// ---------------------------------------------------------------------------
// Events (output of applyAction)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "card_deployed"; playerId: string; cardId: string }
  | { type: "card_bought"; playerId: string; cardId: string; cost: number }
  | { type: "card_drawn"; playerId: string; count: number }
  | { type: "unit_entered"; playerId: string; unitId: string; row: number; col: number }
  | { type: "unit_moved"; playerId: string; unitId: string; fromRow: number; fromCol: number; toRow: number; toCol: number }
  | { type: "unit_injured"; unitId: string; ownerId: string }
  | { type: "unit_killed"; unitId: string; ownerId: string }
  | { type: "event_played"; playerId: string; cardId: string }
  | { type: "trap_set"; playerId: string; cardId: string; targetId?: string }
  | { type: "trap_triggered"; playerId: string; cardId: string; targetId?: string }
  | { type: "item_equipped"; playerId: string; itemId: string; unitId: string }
  | { type: "item_dropped"; itemId: string; row: number; col: number }
  | { type: "location_placed"; row: number; col: number; cardId: string }
  | { type: "location_razed"; row: number; col: number; cardId: string }
  | { type: "mission_completed"; playerId: string; locationId: string; vp: number }
  | { type: "gold_changed"; playerId: string; amount: number; reason: string }
  | { type: "turn_started"; playerId: string; round: number }
  | { type: "turn_ended"; playerId: string }
  | { type: "phase_changed"; from: Phase; to: Phase }
  | { type: "game_ended"; winner?: string; scores: Record<string, number> }
  | { type: "deck_shuffled"; playerId: string; deck: DeckName }
  | { type: "card_destroyed"; playerId: string; cardId: string };

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Filtered game state for a specific player. Hidden info is omitted. */
export interface VisibleState {
  config: GameConfig;
  phase: Phase;
  turn: TurnState;
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
