import prand from "pure-rand";
import type { GameConfig, GameState, PlayerDescriptor, PlayerState, Grid, DeckInput, SeedingState } from "./types";
import { shuffle, extractRngState } from "./rng";

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
    policyPool: [],
  };
}

function createEmptyGrid(config: GameConfig, playerCount: number): Grid {
  // Grid size is (players + grid_padding) x (players + grid_padding)
  // Actual population happens during seeding phase
  const padding = typeof config.grid_padding === "number" ? config.grid_padding : 2;
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

  // Determine turn order — shuffle player ids using seeded RNG
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
    }
  }

  const isSeeding = deckInput.mode === "seeding";

  const seedingState: SeedingState | undefined = isSeeding
    ? {
        step: "seed_draw",
        middleArea: [],
        stealTurnIndex: 0,
        keepSubmitted: [],
        splitSubmitted: [],
      }
    : undefined;

  return {
    config,
    phase: isSeeding ? "seeding" : "main",
    turn: {
      activePlayerId: turnOrder[0],
      actionPointsRemaining: isSeeding
        ? 0
        : (typeof config.action_points_per_turn === "number"
            ? config.action_points_per_turn
            : 3),
      round: 1,
    },
    players: playerStates,
    grid: createEmptyGrid(config, players.length),
    market: [],
    rngState: extractRngState(nextRng),
    seed,
    actionLog: [],
    turnOrder,
    seedingState,
  };
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

