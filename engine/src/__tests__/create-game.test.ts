import { describe, expect, it } from "bun:test";
import { createGame } from "../create-game";
import type { DeckInput } from "../types";
import {
  createSeedingGame,
  createTestGame,
  DEFAULT_CONFIG,
  SEED,
  TWO_PLAYERS,
} from "./helpers";

const MAIN_DECK_INPUT: DeckInput = {
  mode: "main",
  decks: {
    p1: {
      mainDeck: [],
      hand: [],
      prospectDeck: [],
      marketDeck: [],
      activePolicies: [],
    },
    p2: {
      mainDeck: [],
      hand: [],
      prospectDeck: [],
      marketDeck: [],
      activePolicies: [],
    },
  },
};

describe("createGame", () => {
  it("creates a game in main phase with main deck input", () => {
    const state = createTestGame();
    expect(state.phase).toBe("main");
    expect(state.turn).toBeDefined();
  });

  it("creates a game in seeding phase with seeding deck input", () => {
    const state = createSeedingGame();
    expect(state.phase).toBe("seeding");
    expect(state.seedingState).toBeDefined();
    expect(state.seedingState.step).toBe("seed_draw");
    expect(state.seedingState.currentPlayerId).toBe(state.players[0].id);
  });

  it("seeding mode returns no turn property", () => {
    const state = createSeedingGame();
    expect("turn" in state).toBe(false);
  });

  it("main mode returns no seedingState property", () => {
    const state = createTestGame();
    expect("seedingState" in state).toBe(false);
  });

  it("populates seeding decks from input", () => {
    const state = createSeedingGame({ deckSize: 20 });
    for (const player of state.players) {
      expect(player.seedingDeck).toHaveLength(20);
    }
  });

  it("initializes all players with starting gold", () => {
    const state = createTestGame();
    for (const player of state.players) {
      expect(player.gold).toBe(10);
    }
  });

  it("creates a grid of correct size", () => {
    const state = createTestGame();
    // 2 players + 2 padding = 4x4
    expect(state.grid.length).toBe(4);
    expect(state.grid[0].length).toBe(4);
  });

  it("initializes grid cells with null locations", () => {
    const state = createTestGame();
    for (const row of state.grid) {
      for (const cell of row) {
        expect(cell.location).toBeNull();
        expect(cell.units).toEqual([]);
        expect(cell.items).toEqual([]);
      }
    }
  });

  it("sets players in turn order with all player ids", () => {
    const state = createTestGame();
    const playerIds = state.players.map((p) => p.id);
    expect(playerIds).toHaveLength(2);
    expect(playerIds).toContain("p1");
    expect(playerIds).toContain("p2");
  });

  it("sets active player to first in turn order", () => {
    const state = createTestGame();
    expect(state.turn.activePlayerId).toBe(state.players[0].id);
  });

  it("starts with empty action log", () => {
    const state = createTestGame();
    expect(state.actionLog).toEqual([]);
  });

  it("stores serializable RNG state", () => {
    const state = createTestGame();
    expect(Array.isArray(state.rngState)).toBe(true);
    expect(state.rngState.length).toBeGreaterThan(0);
    const json = JSON.stringify(state.rngState);
    expect(JSON.parse(json)).toEqual([...state.rngState]);
  });

  it("initializes empty decks for main phase game", () => {
    const state = createTestGame();
    for (const player of state.players) {
      expect(player.hand).toEqual([]);
      expect(player.mainDeck).toEqual([]);
      expect(player.marketDeck).toEqual([]);
      expect(player.prospectDeck).toEqual([]);
      expect(player.discardPile).toEqual([]);
      expect(player.hq).toEqual([]);
    }
  });

  describe("determinism", () => {
    it("produces identical state for the same seed", () => {
      const s1 = createTestGame();
      const s2 = createTestGame();
      expect(s1.players.map((p) => p.id)).toEqual(s2.players.map((p) => p.id));
      expect(s1.rngState).toEqual(s2.rngState);
    });

    it("produces different state for different seeds", () => {
      const s1 = createTestGame({ seed: "seed-a" });
      const s2 = createTestGame({ seed: "seed-b" });
      expect(s1.rngState).not.toEqual(s2.rngState);
    });
  });

  describe("validation", () => {
    it("rejects empty players array", () => {
      expect(() =>
        createGame(DEFAULT_CONFIG, [], SEED, MAIN_DECK_INPUT),
      ).toThrow("at least one player");
    });

    it("rejects duplicate player IDs", () => {
      expect(() =>
        createGame(
          DEFAULT_CONFIG,
          [
            { id: "p1", name: "A" },
            { id: "p1", name: "B" },
          ],
          SEED,
          MAIN_DECK_INPUT,
        ),
      ).toThrow("Duplicate player IDs");
    });

    it("rejects empty seed", () => {
      expect(() =>
        createGame(DEFAULT_CONFIG, TWO_PLAYERS, "", MAIN_DECK_INPUT),
      ).toThrow("non-empty seed");
    });
  });

  describe("config defaults", () => {
    it("defaults starting gold to 10 if not in config", () => {
      const state = createTestGame({ config: {} });
      for (const player of state.players) {
        expect(player.gold).toBe(10);
      }
    });

    it("defaults grid padding to 2 if not in config", () => {
      const state = createTestGame({ config: {} });
      // 2 players + 2 default padding = 4x4
      expect(state.grid.length).toBe(4);
    });

    it("uses config values when provided", () => {
      const state = createTestGame({
        config: { starting_gold: 20, grid_padding: 3 },
      });
      for (const player of state.players) {
        expect(player.gold).toBe(20);
      }
      // 2 players + 3 padding = 5x5
      expect(state.grid.length).toBe(5);
    });
  });
});
