import prand from "pure-rand";
import { extractRngState, shuffle } from "./rng";
import type {
  DeckInput,
  GameConfig,
  GameState,
  Grid,
  MainGameState,
  PlayerDescriptor,
  PlayerState,
  SeedingGameState,
} from "./types";

function createPlayerState(descriptor: PlayerDescriptor): PlayerState {
  return {
    id: descriptor.id,
    name: descriptor.name,
    team: descriptor.team,
    gold: 0,
    vp: 0,
    hand: [],
    seedingDeck: [],
    mainDeck: [],
    marketDeck: [],
    prospectDeck: [],
    discardPile: [],
    removedFromGame: [],
    hq: [],
    activePolicies: [],
    activeTraps: [],
    passiveEvents: [],
    policyPool: [],
  };
}

function createEmptyGrid(config: GameConfig, playerCount: number): Grid {
  // Grid size is (players + grid_padding) x (players + grid_padding)
  // Actual population happens during seeding phase
  const padding =
    typeof config.grid_padding === "number" ? config.grid_padding : 2;
  const size = playerCount + padding;
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      location: null,
      units: [],
      items: [],
    })),
  );
}

/**
 * Initialize a new game. Returns the starting GameState.
 *
 * DeckInput determines the starting mode:
 * - "seeding": populate seeding decks + policy pools, start in seeding phase
 * - "main": populate pre-built decks, skip directly to main phase
 *   Accepts optional grid, market, and per-player gold overrides.
 *
 * Callers decide which mode to use based on variant config (e.g.
 * config["seeding-phase"] === "pre-built"). See buildPrebuiltDeckInput()
 * for a convenience helper.
 */
export function createGame(
  config: GameConfig,
  players: PlayerDescriptor[],
  seed: string,
  deckInput: DeckInput,
): GameState {
  if (players.length === 0) {
    throw new Error("createGame requires at least one player");
  }

  const ids = players.map((p) => p.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new Error(
      `Duplicate player IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`,
    );
  }

  if (!seed) {
    throw new Error("createGame requires a non-empty seed string");
  }

  const rng = prand.mersenne(hashSeed(seed));

  // Shuffle player IDs to determine players array ordering (which defines turn order)
  const [turnOrder, nextRng] = shuffle(ids, rng);

  const startingGold =
    typeof config.starting_gold === "number" ? config.starting_gold : 10;

  const playerStates = players.map((p) => {
    const state = createPlayerState(p);
    state.gold = startingGold;
    return state;
  });

  // Populate decks based on input mode
  if (deckInput.mode === "seeding") {
    for (const ps of playerStates) {
      const input = deckInput.decks[ps.id];
      if (!input) {
        throw new Error(`No seeding deck provided for player "${ps.id}"`);
      }
      ps.seedingDeck = [...input.seedingDeck];
      ps.policyPool = [...input.policyPool];
    }
  } else {
    for (const ps of playerStates) {
      const input = deckInput.decks[ps.id];
      if (!input) {
        throw new Error(`No deck input provided for player "${ps.id}"`);
      }
      ps.mainDeck = [...input.mainDeck];
      ps.hand = [...input.hand];
      ps.prospectDeck = [...input.prospectDeck];
      ps.marketDeck = [...input.marketDeck];
      ps.activePolicies = [...input.activePolicies];
      if (input.gold !== undefined) {
        ps.gold = input.gold;
      }
    }
  }

  // Reorder players to match shuffled turn order
  const orderedPlayers = turnOrder.map((id) => {
    const ps = playerStates.find((p) => p.id === id);
    if (!ps) throw new Error(`Player "${id}" not found`);
    return ps;
  });

  const base = {
    config,
    players: orderedPlayers,
    grid:
      deckInput.mode === "main" && deckInput.grid
        ? deckInput.grid
        : createEmptyGrid(config, players.length),
    market:
      deckInput.mode === "main" && deckInput.market
        ? [...deckInput.market]
        : [],
    rngState: extractRngState(nextRng),
    seed,
    actionLog: [],
  };

  if (deckInput.mode === "seeding") {
    return {
      ...base,
      phase: "seeding",
      seedingState: {
        step: "seed_draw",
        currentPlayerId: orderedPlayers[0].id,
        middleArea: [],
        stealTurnIndex: 0,
        keepSubmitted: [],
      },
    } satisfies SeedingGameState;
  }

  return {
    ...base,
    phase: "main",
    turn: {
      activePlayerId: orderedPlayers[0].id,
      actionPointsRemaining:
        typeof config.action_points_per_turn === "number"
          ? config.action_points_per_turn
          : 3,
      round: 1,
    },
  } satisfies MainGameState;
}

/** Convert a string seed to a numeric seed for pure-rand (FNV-1a). */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}
