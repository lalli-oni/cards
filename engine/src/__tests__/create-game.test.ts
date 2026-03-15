import { describe, expect, it } from "bun:test";
import { createGame } from "../create-game";
import { createTestGame, DEFAULT_CONFIG, TWO_PLAYERS, SEED } from "./helpers";

describe("createGame", () => {
  it("creates a game in the seeding phase", () => {
    const state = createTestGame();
    expect(state.phase).toBe("seeding");
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

  it("sets turn order containing all player ids", () => {
    const state = createTestGame();
    expect(state.turnOrder).toHaveLength(2);
    expect(state.turnOrder).toContain("p1");
    expect(state.turnOrder).toContain("p2");
  });

  it("sets active player to first in turn order", () => {
    const state = createTestGame();
    expect(state.turn.activePlayerId).toBe(state.turnOrder[0]);
  });

  it("starts with empty action log", () => {
    const state = createTestGame();
    expect(state.actionLog).toEqual([]);
  });

  it("stores serializable RNG state", () => {
    const state = createTestGame();
    expect(Array.isArray(state.rngState)).toBe(true);
    expect(state.rngState.length).toBeGreaterThan(0);
    // Should be JSON-serializable
    const json = JSON.stringify(state.rngState);
    expect(JSON.parse(json)).toEqual([...state.rngState]);
  });

  it("initializes empty decks for all players", () => {
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
      expect(s1.turnOrder).toEqual(s2.turnOrder);
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
      expect(() => createGame(DEFAULT_CONFIG, [], SEED)).toThrow(
        "at least one player",
      );
    });

    it("rejects duplicate player IDs", () => {
      expect(() =>
        createGame(
          DEFAULT_CONFIG,
          [{ id: "p1", name: "A" }, { id: "p1", name: "B" }],
          SEED,
        ),
      ).toThrow("Duplicate player IDs");
    });

    it("rejects empty seed", () => {
      expect(() => createGame(DEFAULT_CONFIG, TWO_PLAYERS, "")).toThrow(
        "non-empty seed",
      );
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
