import prand from "pure-rand";
import type { GameConfig, GameState, PlayerDescriptor, PlayerState, Grid } from "./types";

function createPlayerState(descriptor: PlayerDescriptor): PlayerState {
  return {
    id: descriptor.id,
    name: descriptor.name,
    team: descriptor.team,
    gold: 0,
    vp: 0,
    hand: [],
    mainDeck: [],
    marketDeck: [],
    prospectDeck: [],
    discardPile: [],
    removedFromGame: [],
    hq: [],
    activePolicies: [],
    activeTraps: [],
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
 * The state begins in the "seeding" phase.
 */
export function createGame(
  config: GameConfig,
  players: PlayerDescriptor[],
  seed: string,
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
  const [turnOrder, nextRng] = seededShuffle(ids, rng);

  const startingGold =
    typeof config.starting_gold === "number" ? config.starting_gold : 10;

  const playerStates = players.map((p) => {
    const state = createPlayerState(p);
    state.gold = startingGold;
    return state;
  });

  return {
    config,
    phase: "seeding",
    turn: {
      activePlayerId: turnOrder[0],
      actionPointsRemaining: 0, // seeding phase doesn't use AP
      round: 1,
    },
    players: playerStates,
    grid: createEmptyGrid(config, players.length),
    market: [],
    rngState: nextRng.getState!()!,
    seed,
    actionLog: [],
    turnOrder,
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

/** Fisher-Yates shuffle using seeded RNG. Returns shuffled array and new RNG state. */
function seededShuffle<T>(
  array: T[],
  rng: prand.RandomGenerator,
): [T[], prand.RandomGenerator] {
  const result = [...array];
  let currentRng = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, nextRng] = prand.uniformIntDistribution(0, i, currentRng);
    currentRng = nextRng;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, currentRng];
}
