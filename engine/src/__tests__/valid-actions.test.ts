import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import type { EndedGameState } from "../types";
import { getActivePlayerId } from "../types";
import { getValidActions } from "../valid-actions";
import { createSeedingGame, createTestGame } from "./helpers";

describe("getValidActions", () => {
  describe("main phase", () => {
    it("always includes pass for the active player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, state.turn.activePlayerId);
      const types = actions.map((a) => a.type);
      expect(types).toContain("pass");
      // draw requires cards in deck or discard — empty by default
      expect(types).not.toContain("draw");
      expect(actions[0].playerId).toBe(state.turn.activePlayerId);
    });

    it("returns empty array for non-active player", () => {
      const state = createTestGame();
      // biome-ignore lint/style/noNonNullAssertion: 2-player game always has a non-active player
      const nonActive = state.turnOrder.find(
        (id) => id !== state.turn.activePlayerId,
      )!;
      const actions = getValidActions(state, nonActive);
      expect(actions).toEqual([]);
    });

    it("returns empty array when game has ended", () => {
      const base = createTestGame();
      const endedState: EndedGameState = {
        ...base,
        phase: "ended",
      };
      const actions = getValidActions(
        endedState,
        endedState.turn.activePlayerId,
      );
      expect(actions).toEqual([]);
    });

    it("returns empty array for unknown player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, "nonexistent");
      expect(actions).toEqual([]);
    });
  });

  describe("getActivePlayerId", () => {
    it("returns activePlayerId for main phase", () => {
      const state = createTestGame();
      expect(getActivePlayerId(state)).toBe(state.turn.activePlayerId);
    });

    it("returns currentPlayerId for seeding phase", () => {
      const state = createSeedingGame();
      expect(getActivePlayerId(state)).toBe(state.seedingState.currentPlayerId);
    });

    it("throws for ended phase", () => {
      const base = createTestGame();
      const endedState: EndedGameState = { ...base, phase: "ended" };
      expect(() => getActivePlayerId(endedState)).toThrow(
        "No active player in ended phase",
      );
    });
  });

  describe("seeding phase", () => {
    it("returns seed_draw at seed_draw step", () => {
      const state = createSeedingGame();
      const activeId = state.seedingState.currentPlayerId;
      const actions = getValidActions(state, activeId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_draw");
    });

    it("returns seed_keep at seed_keep step", () => {
      const state = produce(createSeedingGame(), (draft) => {
        draft.seedingState.step = "seed_keep";
      });
      const activeId = state.seedingState.currentPlayerId;
      const actions = getValidActions(state, activeId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_keep");
    });
  });
});
