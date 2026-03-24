import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import type { EndedGameState, MainGameState } from "../types";
import { getVisibleState } from "../visible-state";
import {
  createSeedingGame,
  createTestGame,
  makeTrapEvent,
  makeUnit,
  resetIds,
} from "./helpers";

describe("getVisibleState", () => {
  beforeEach(() => resetIds());

  it("throws for unknown player", () => {
    const state = createTestGame();
    expect(() => getVisibleState(state, "unknown")).toThrow("not found");
  });

  it("returns self as full PlayerState", () => {
    const state = createTestGame();
    const vis = getVisibleState(state, "p1");
    expect(vis.self.id).toBe("p1");
    expect(vis.playerId).toBe("p1");
  });

  it("populates currentPlayerId", () => {
    const state = createTestGame();
    const vis = getVisibleState(state, "p1");
    expect(vis.currentPlayerId).toBe(state.turn.activePlayerId);
  });

  describe("no teams (free-for-all)", () => {
    it("shows all other players as opponents", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(1);
      expect(vis.opponents[0].id).toBe("p2");
      expect(vis.teammates).toHaveLength(0);
    });
  });

  describe("with teams", () => {
    const teamPlayers = [
      { id: "p1", name: "Alice", team: "red" },
      { id: "p2", name: "Bob", team: "red" },
      { id: "p3", name: "Carol", team: "blue" },
    ];

    it("shows teammates with full visibility", () => {
      const state = createTestGame({ players: teamPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.teammates).toHaveLength(1);
      expect(vis.teammates[0].id).toBe("p2");
      // Teammates have full PlayerState (hand array, not handSize)
      expect(Array.isArray(vis.teammates[0].hand)).toBe(true);
    });

    it("shows non-teammates as opponents", () => {
      const state = createTestGame({ players: teamPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(1);
      expect(vis.opponents[0].id).toBe("p3");
    });

    it("teamless player sees everyone as opponent", () => {
      const mixedPlayers = [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob", team: "red" },
        { id: "p3", name: "Carol" },
      ];
      const state = createTestGame({ players: mixedPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(2);
      expect(vis.teammates).toHaveLength(0);
    });
  });

  describe("opponent info hiding", () => {
    it("replaces hand with handSize", () => {
      const state = withCardsInHand(createTestGame(), "p2", 3);
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents[0].handSize).toBe(3);
      expect("hand" in vis.opponents[0]).toBe(false);
    });

    it("replaces deck arrays with sizes", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      const opp = vis.opponents[0];
      expect(typeof opp.mainDeckSize).toBe("number");
      expect(typeof opp.marketDeckSize).toBe("number");
      expect(typeof opp.prospectDeckSize).toBe("number");
      expect(typeof opp.discardPileSize).toBe("number");
    });

    it("redacts trap card contents", () => {
      const state = withTrap(createTestGame(), "p2", "target-123");
      const vis = getVisibleState(state, "p1");
      const trap = vis.opponents[0].activeTraps[0];
      expect(trap.targetId).toBe("target-123");
      expect("card" in trap).toBe(false);
    });
  });

  describe("shared state", () => {
    it("includes grid for all players", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.grid).toBe(state.grid);
    });

    it("includes market for all players", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.market).toBe(state.market);
    });

    it("includes turn order", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.turnOrder).toEqual(state.turnOrder);
    });

    it("includes turn for main phase", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.turn).toBeDefined();
      expect(vis.turn?.activePlayerId).toBe(state.turn.activePlayerId);
    });
  });

  describe("seeding phase", () => {
    it("has turn undefined during seeding", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.turn).toBeUndefined();
    });

    it("populates currentPlayerId from seedingState", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.currentPlayerId).toBe(state.seedingState.currentPlayerId);
    });

    it("includes seedingStep", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.seedingStep).toBe("seed_draw");
    });
  });

  describe("ended phase", () => {
    it("does not throw for ended game", () => {
      const base = createTestGame();
      const endedState: EndedGameState = { ...base, phase: "ended" };
      const vis = getVisibleState(endedState, "p1");
      expect(vis.phase).toBe("ended");
      expect(vis.currentPlayerId).toBe(base.turn.activePlayerId);
    });
  });
});

// ---- Helpers to set up specific state for tests ----

function withCardsInHand(
  state: MainGameState,
  playerId: string,
  count: number,
): MainGameState {
  return produce(state, (draft) => {
    // biome-ignore lint/style/noNonNullAssertion: test helper with known player IDs
    const player = draft.players.find((p) => p.id === playerId)!;
    for (let i = 0; i < count; i++) {
      player.hand.push(makeUnit({ ownerId: playerId }));
    }
  });
}

function withTrap(
  state: MainGameState,
  playerId: string,
  targetId: string,
): MainGameState {
  return produce(state, (draft) => {
    // biome-ignore lint/style/noNonNullAssertion: test helper with known player IDs
    const player = draft.players.find((p) => p.id === playerId)!;
    player.activeTraps.push({
      card: makeTrapEvent({ ownerId: playerId, trigger: "test" }),
      targetId,
    });
  });
}
