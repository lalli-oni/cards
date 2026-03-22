import prand from "pure-rand";
import { createGame } from "../create-game";
import type {
  Card,
  DeckInput,
  EventCard,
  GameConfig,
  GameState,
  ItemCard,
  LocationCard,
  LocationEdges,
  MainGameState,
  PlayerDescriptor,
  PolicyCard,
  SeedingGameState,
  UnitCard,
} from "../types";

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

export function makeUnit(
  overrides: Partial<UnitCard> & { ownerId: string },
): UnitCard {
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

export function makeLocation(
  overrides: Partial<LocationCard> & { ownerId: string },
): LocationCard {
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

export function makeItem(
  overrides: Partial<ItemCard> & { ownerId: string },
): ItemCard {
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

export function makeEvent(
  overrides: Partial<EventCard> & {
    ownerId: string;
    subtype: EventCard["subtype"];
  },
): EventCard {
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

export function makePolicy(
  overrides: Partial<PolicyCard> & { ownerId: string },
): PolicyCard {
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
  seed_draw: 10,
  seed_keep: 8,
  seed_expose: 2,
  seed_main_deck_draw: 15,
  starting_hand_size: 5,
};

export const TWO_PLAYERS: PlayerDescriptor[] = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
];

export const SEED = "test-seed";

/** Create a standard 2-player game with pre-built decks (main phase). */
export function createTestGame(overrides?: {
  config?: GameConfig;
  players?: PlayerDescriptor[];
  seed?: string;
  deckInput?: DeckInput;
}): MainGameState {
  const players = overrides?.players ?? TWO_PLAYERS;
  const deckInput: DeckInput = overrides?.deckInput ?? {
    mode: "main",
    decks: Object.fromEntries(
      players.map((p) => [
        p.id,
        {
          mainDeck: [],
          hand: [],
          prospectDeck: [],
          marketDeck: [],
          activePolicies: [],
        },
      ]),
    ),
  };
  return createGame(
    overrides?.config ?? DEFAULT_CONFIG,
    players,
    overrides?.seed ?? SEED,
    deckInput,
  ) as MainGameState;
}

/** Build a seeding deck with a mix of card types for a player. */
export function makeSeedingDeck(ownerId: string, count: number): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) {
    // Alternate between units, items, locations, events
    const mod = i % 4;
    if (mod === 0) {
      cards.push(makeUnit({ ownerId }));
    } else if (mod === 1) {
      cards.push(makeItem({ ownerId }));
    } else if (mod === 2) {
      cards.push(makeLocation({ ownerId }));
    } else {
      cards.push(makeEvent({ ownerId, subtype: "instant" }));
    }
  }
  return cards;
}

/** Create a 2-player game in seeding phase with populated seeding decks. */
export function createSeedingGame(overrides?: {
  config?: GameConfig;
  players?: PlayerDescriptor[];
  seed?: string;
  deckSize?: number;
  policyCount?: number;
}): SeedingGameState {
  const players = overrides?.players ?? TWO_PLAYERS;
  const deckSize = overrides?.deckSize ?? 10;
  const policyCount = overrides?.policyCount ?? 3;

  const decks: Record<
    string,
    { seedingDeck: Card[]; policyPool: PolicyCard[] }
  > = {};
  for (const p of players) {
    decks[p.id] = {
      seedingDeck: makeSeedingDeck(p.id, deckSize),
      policyPool: Array.from({ length: policyCount }, () =>
        makePolicy({ ownerId: p.id }),
      ),
    };
  }

  return createGame(
    overrides?.config ?? DEFAULT_CONFIG,
    players,
    overrides?.seed ?? SEED,
    { mode: "seeding", decks },
  ) as SeedingGameState;
}

/** Get the RNG from a game state (reconstructed from stored state). */
export function getRng(state: GameState): prand.RandomGenerator {
  return prand.mersenne.fromState(state.rngState);
}
