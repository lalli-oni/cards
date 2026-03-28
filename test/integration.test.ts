/**
 * Integration tests for the card game engine (#18).
 *
 * These tests exercise full game flows with real card data and greedy
 * BotAdapters, verify determinism, and test session portability.
 */
import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  BotAdapter,
  GameController,
  buildPrebuiltDeckInput,
  createGame,
  createInstanceCounter,
  getActivePlayerId,
  instantiateCards,
  loadCardDefinitionsFromBuild,
  type Card,
  type CardDefinition,
  type EndedGameState,
  type GameConfig,
  type Grid,
  type GridCell,
  type LocationCard,
  type PlayerAdapter,
  type PlayerDescriptor,
  type PolicyCard,
} from "cards-engine";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const BUILD_DIR = join(import.meta.dir, "../library/build");

const DEFAULT_CONFIG: GameConfig = {
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
  max_hand_size: 7,
  raze_ap_cost: 3,
  combat_kill_ratio: 2,
};

type DeckInput = Parameters<typeof createGame>[3];

function makePlayers(count: number): PlayerDescriptor[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
}

function makeAdapters(
  players: PlayerDescriptor[],
  strategy: "random" | "greedy" = "greedy",
): Map<string, PlayerAdapter> {
  return new Map(
    players.map((p, i) => [p.id, new BotAdapter(i + 1, strategy)]),
  );
}

function buildSeedingInput(
  players: PlayerDescriptor[],
  defs: CardDefinition[],
): DeckInput {
  const counter = createInstanceCounter();
  const nonPolicy = defs.filter((d) => d.type !== "policy");
  const policies = defs.filter((d) => d.type === "policy");

  const decks: Record<string, { seedingDeck: Card[]; policyPool: PolicyCard[] }> = {};
  for (const p of players) {
    decks[p.id] = {
      seedingDeck: instantiateCards(nonPolicy, p.id, counter) as Card[],
      policyPool: instantiateCards(policies, p.id, counter) as PolicyCard[],
    };
  }
  return { mode: "seeding" as const, decks };
}

/** Run a full game (seeding → main → ended) with greedy bots. */
async function runFullGame(opts: {
  players?: PlayerDescriptor[];
  seed?: string;
  config?: GameConfig;
  maxActions?: number;
}): Promise<GameController> {
  const players = opts.players ?? makePlayers(2);
  const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
  const deckInput = buildSeedingInput(players, defs);

  const controller = new GameController({
    config: opts.config ?? DEFAULT_CONFIG,
    players,
    seed: opts.seed ?? "integration-seed",
    deckInput,
    adapters: makeAdapters(players),
  });

  await controller.run(opts.maxActions ?? 10_000);
  return controller;
}

// ---------------------------------------------------------------------------
// Full game flow
// ---------------------------------------------------------------------------

describe("full game flow", () => {
  // seed-2 is known to produce a decisive winner with the current alpha-1
  // card library and greedy bots. If the card set changes, this seed may
  // need updating — pick one where scores differ at the turn limit.
  const DECISIVE_SEED = "seed-2";

  it("runs a 1v1 game to completion (seeding → main → ended)", async () => {
    const controller = await runFullGame({ seed: DECISIVE_SEED });
    const state = controller.getState() as EndedGameState;

    expect(state.phase).toBe("ended");
    expect(state.winner).toBeDefined();
    expect(Object.keys(state.scores)).toHaveLength(2);
    expect(state.turn.round).toBeGreaterThan(0);
  });

  it("runs a 3-player game to completion", async () => {
    const controller = await runFullGame({
      players: makePlayers(3),
      seed: DECISIVE_SEED,
    });
    const state = controller.getState() as EndedGameState;

    expect(state.phase).toBe("ended");
    expect(Object.keys(state.scores)).toHaveLength(3);
  });

  it("runs a 4-player game to completion", async () => {
    const controller = await runFullGame({
      players: makePlayers(4),
      seed: DECISIVE_SEED,
    });
    const state = controller.getState() as EndedGameState;

    expect(state.phase).toBe("ended");
    expect(Object.keys(state.scores)).toHaveLength(4);
  });

  it("winner has VP from completed missions", async () => {
    const controller = await runFullGame({ seed: DECISIVE_SEED });
    const state = controller.getState() as EndedGameState;

    expect(state.scores[state.winner!]).toBeGreaterThan(0);
  });

  it("produces a valid session on game end", async () => {
    const controller = await runFullGame({ seed: DECISIVE_SEED });
    const session = controller.toSession();

    expect(session.version).toBe("0.1.0");
    expect(session.actions.length).toBeGreaterThan(0);
    expect(session.result).toBeDefined();
    expect(session.result!.winner).toBeDefined();
    expect(session.result!.rounds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  const DET_SEED = "seed-3";

  it("same seed produces identical final state", async () => {
    const c1 = await runFullGame({ seed: DET_SEED });
    const c2 = await runFullGame({ seed: DET_SEED });

    const s1 = c1.getState() as EndedGameState;
    const s2 = c2.getState() as EndedGameState;

    expect(s1.phase).toBe("ended");
    expect(s2.phase).toBe("ended");
    expect(s1.winner).toBe(s2.winner);
    expect(s1.scores).toEqual(s2.scores);
    expect(s1.turn.round).toBe(s2.turn.round);
    expect(s1.actionLog.length).toBe(s2.actionLog.length);
  });

  it("different seeds produce different games", async () => {
    const c1 = await runFullGame({ seed: "seed-2" });
    const c2 = await runFullGame({ seed: "seed-4" });

    const s1 = c1.getState() as EndedGameState;
    const s2 = c2.getState() as EndedGameState;

    // At least action count or scores should differ
    const identical =
      s1.actionLog.length === s2.actionLog.length &&
      JSON.stringify(s1.scores) === JSON.stringify(s2.scores);
    expect(identical).toBe(false);
  });

  it("action log replay produces identical state", async () => {
    const players = makePlayers(2);
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    const deckInput = buildSeedingInput(players, defs);

    const controller = await runFullGame({ seed: DET_SEED, players });
    const session = controller.toSession();

    // Replay from action log (no snapshot)
    const replayed = GameController.fromSession(
      { ...session, snapshot: undefined },
      deckInput,
      makeAdapters(players),
    );

    const original = controller.getState() as EndedGameState;
    const replayedState = replayed.getState() as EndedGameState;

    expect(replayedState.phase).toBe("ended");
    expect(replayedState.winner).toBe(original.winner);
    expect(replayedState.scores).toEqual(original.scores);
    expect(replayedState.actionLog.length).toBe(original.actionLog.length);
  });

  it("cross-client portability: session transfer mid-game", async () => {
    const players = makePlayers(2);
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    const deckInput = buildSeedingInput(players, defs);

    const controller = new GameController({
      config: DEFAULT_CONFIG,
      players,
      seed: "portability-test",
      deckInput,
      adapters: makeAdapters(players),
    });

    // Play up to 50 actions to get into mid-game
    for (let i = 0; i < 50; i++) {
      if (controller.getState().phase === "ended") break;
      await controller.playTurn();
    }

    // Serialize with snapshot and load in a new controller
    const session = controller.toSession(true);
    const c2 = GameController.fromSession(
      session,
      deckInput,
      makeAdapters(players),
    );

    expect(c2.getState().phase).toBe(controller.getState().phase);
    expect(c2.getState().actionLog.length).toBe(
      controller.getState().actionLog.length,
    );
    expect(getActivePlayerId(c2.getState())).toBe(
      getActivePlayerId(controller.getState()),
    );
  });
});

// ---------------------------------------------------------------------------
// Real card data
// ---------------------------------------------------------------------------

describe("real card data", () => {
  it("loads card definitions from build output", () => {
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    expect(defs.length).toBeGreaterThan(0);

    const types = new Set(defs.map((d) => d.type));
    expect(types.has("unit")).toBe(true);
    expect(types.has("location")).toBe(true);
    expect(types.has("item")).toBe(true);
    expect(types.has("event")).toBe(true);
    expect(types.has("policy")).toBe(true);
  });

  it("instantiates cards with unique IDs", () => {
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    const counter = createInstanceCounter();
    const cards = instantiateCards(defs, "p1", counter);

    expect(cards.length).toBe(defs.length);
    const ids = new Set(cards.map((c) => c.id));
    expect(ids.size).toBe(cards.length);
  });

  it("creates a seeding game with real cards", () => {
    const players = makePlayers(2);
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    const deckInput = buildSeedingInput(players, defs);

    const state = createGame(DEFAULT_CONFIG, players, "real-cards", deckInput);
    expect(state.phase).toBe("seeding");
    expect(state.players[0].seedingDeck.length).toBeGreaterThan(0);
  });

  it("real cards survive the full seeding pipeline", async () => {
    const controller = await runFullGame({ seed: "seed-3" });
    const state = controller.getState() as EndedGameState;

    // Players should have cards distributed across zones
    for (const player of state.players) {
      const totalCards =
        player.hand.length +
        player.mainDeck.length +
        player.discardPile.length;
      expect(totalCards).toBeGreaterThan(0);
    }

    // Grid should have locations placed
    let locationCount = 0;
    for (const row of state.grid) {
      for (const cell of row) {
        if (cell.location) locationCount++;
      }
    }
    expect(locationCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Pre-built game flow (#44)
// ---------------------------------------------------------------------------

describe("pre-built game flow", () => {
  function buildPrebuiltGame(opts?: {
    players?: PlayerDescriptor[];
    seed?: string;
    config?: GameConfig;
  }) {
    const players = opts?.players ?? makePlayers(2);
    const config = opts?.config ?? DEFAULT_CONFIG;
    const defs = loadCardDefinitionsFromBuild(BUILD_DIR);
    const counter = createInstanceCounter();

    const locations = defs.filter((d) => d.type === "location");
    const policies = defs.filter((d) => d.type === "policy");
    const nonLocationNonPolicy = defs.filter(
      (d) => d.type !== "location" && d.type !== "policy",
    );

    // Build a grid with locations assigned to players in round-robin
    const gridSize = players.length + (typeof config.grid_padding === "number" ? config.grid_padding : 2);
    const grid: Grid = Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, (): GridCell => ({
        location: null,
        units: [],
        items: [],
      })),
    );

    // Place one location per player in the first row
    const placedLocations: LocationCard[] = [];
    for (let i = 0; i < players.length; i++) {
      const locDef = locations[i % locations.length];
      const loc = instantiateCards([locDef], players[i].id, counter)[0] as LocationCard;
      grid[0][i].location = loc;
      placedLocations.push(loc);
    }

    // Distribute non-location cards across players
    const perPlayer = Math.floor(nonLocationNonPolicy.length / players.length);
    const playerDecks: Record<string, {
      mainDeck: Card[];
      hand: Card[];
      prospectDeck: Card[];
      marketDeck: Card[];
      activePolicies: PolicyCard[];
      gold?: number;
    }> = {};

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const slice = nonLocationNonPolicy.slice(i * perPlayer, (i + 1) * perPlayer);
      const cards = instantiateCards(slice, p.id, counter) as Card[];
      const policyCards = instantiateCards(
        policies.slice(0, 2),
        p.id,
        counter,
      ) as PolicyCard[];

      // Remaining locations go to prospect deck
      const remainingLocs = locations.slice(players.length);
      const prospectCards = instantiateCards(
        remainingLocs.slice(i * 3, (i + 1) * 3),
        p.id,
        counter,
      ) as Card[];

      playerDecks[p.id] = {
        hand: cards.slice(0, 5),
        mainDeck: cards.slice(5, 20),
        marketDeck: cards.slice(20),
        prospectDeck: prospectCards,
        activePolicies: policyCards,
      };
    }

    const deckInput = buildPrebuiltDeckInput({
      players: playerDecks,
      grid,
    });

    return { players, deckInput, config, seed: opts?.seed ?? "prebuilt-seed" };
  }

  it("starts directly in main phase (no seeding)", () => {
    const { players, deckInput, config, seed } = buildPrebuiltGame();
    const state = createGame(config, players, seed, deckInput);

    expect(state.phase).toBe("main");
    expect("seedingState" in state).toBe(false);
  });

  it("preserves the pre-populated grid", () => {
    const { players, deckInput, config, seed } = buildPrebuiltGame();
    const state = createGame(config, players, seed, deckInput);

    let locationCount = 0;
    for (const row of state.grid) {
      for (const cell of row) {
        if (cell.location) locationCount++;
      }
    }
    expect(locationCount).toBe(players.length);
  });

  it("runs a pre-built game to completion with bots", async () => {
    const { players, deckInput, config, seed } = buildPrebuiltGame();
    const controller = new GameController({
      config,
      players,
      seed,
      deckInput,
      adapters: makeAdapters(players),
    });

    await controller.run(10_000);
    const state = controller.getState() as EndedGameState;

    expect(state.phase).toBe("ended");
    expect(Object.keys(state.scores)).toHaveLength(2);
    expect(state.turn.round).toBeGreaterThan(0);
  });

  it("produces a valid session from a pre-built game", async () => {
    const { players, deckInput, config, seed } = buildPrebuiltGame();
    const controller = new GameController({
      config,
      players,
      seed,
      deckInput,
      adapters: makeAdapters(players),
    });

    await controller.run(10_000);
    const session = controller.toSession();

    expect(session.version).toBe("0.1.0");
    expect(session.actions.length).toBeGreaterThan(0);
    expect(session.result).toBeDefined();
  });
});
