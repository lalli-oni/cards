import { describe, expect, it, beforeEach } from "bun:test";
import { getVisibleState } from "../visible-state";
import { createTestGame, makeUnit, makeEvent, resetIds } from "./helpers";
import type { GameState } from "../types";
import { produce } from "immer";

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
  });
});

// ---- Helpers to set up specific state for tests ----

function withCardsInHand(state: GameState, playerId: string, count: number): GameState {
  return produce(state, (draft) => {
    const player = draft.players.find((p) => p.id === playerId)!;
    for (let i = 0; i < count; i++) {
      player.hand.push(makeUnit({ ownerId: playerId }));
    }
  });
}

function withTrap(state: GameState, playerId: string, targetId: string): GameState {
  return produce(state, (draft) => {
    const player = draft.players.find((p) => p.id === playerId)!;
    player.activeTraps.push({
      card: makeEvent({ ownerId: playerId, subtype: "trap", trigger: "test" }),
      targetId,
    });
  });
}
