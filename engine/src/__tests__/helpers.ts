import prand from "pure-rand";
import type {
  GameConfig,
  GameState,
  PlayerDescriptor,
  UnitCard,
  LocationCard,
  ItemCard,
  EventCard,
  PolicyCard,
  LocationEdges,
} from "../types";
import { createGame } from "../create-game";

let instanceCounter = 0;

function nextId(): string {
  return `inst-${++instanceCounter}`;
}

/** Reset the instance counter between tests. */
export function resetIds(): void {
  instanceCounter = 0;
}

// ---- Card factories ----

const defaultEdges: LocationEdges = { n: true, e: true, s: true, w: true };

export function makeUnit(overrides: Partial<UnitCard> & { ownerId: string }): UnitCard {
  return {
    id: nextId(),
    definitionId: "test-unit",
    type: "unit",
    name: "Test Unit",
    cost: "1",
    rarity: "common",
    strength: 5,
    cunning: 5,
    charisma: 5,
    attributes: [],
    injured: false,
    ...overrides,
  };
}

export function makeLocation(overrides: Partial<LocationCard> & { ownerId: string }): LocationCard {
  return {
    id: nextId(),
    definitionId: "test-location",
    type: "location",
    name: "Test Location",
    cost: "0",
    rarity: "common",
    edges: { ...defaultEdges },
    ...overrides,
  };
}

export function makeItem(overrides: Partial<ItemCard> & { ownerId: string }): ItemCard {
  return {
    id: nextId(),
    definitionId: "test-item",
    type: "item",
    name: "Test Item",
    cost: "1",
    rarity: "common",
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<EventCard> & { ownerId: string; subtype: EventCard["subtype"] }): EventCard {
  return {
    id: nextId(),
    definitionId: "test-event",
    type: "event",
    name: "Test Event",
    cost: "1",
    rarity: "common",
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<PolicyCard> & { ownerId: string }): PolicyCard {
  return {
    id: nextId(),
    definitionId: "test-policy",
    type: "policy",
    name: "Test Policy",
    cost: "0",
    rarity: "common",
    effect: "Test effect",
    ...overrides,
  };
}

// ---- Game factories ----

export const DEFAULT_CONFIG: GameConfig = {
  starting_gold: 10,
  grid_padding: 2,
  action_points_per_turn: 3,
  vp_threshold: 50,
  turn_limit: 20,
};

export const TWO_PLAYERS: PlayerDescriptor[] = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
];

export const SEED = "test-seed";

/** Create a standard 2-player game with default config. */
export function createTestGame(
  overrides?: {
    config?: GameConfig;
    players?: PlayerDescriptor[];
    seed?: string;
  },
): GameState {
  return createGame(
    overrides?.config ?? DEFAULT_CONFIG,
    overrides?.players ?? TWO_PLAYERS,
    overrides?.seed ?? SEED,
  );
}

/** Get the RNG from a game state (reconstructed from stored state). */
export function getRng(state: GameState): prand.RandomGenerator {
  return prand.mersenne.fromState(state.rngState);
}
