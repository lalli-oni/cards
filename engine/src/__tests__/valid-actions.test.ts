import { describe, expect, it } from "bun:test";
import { getValidActions } from "../valid-actions";
import { createTestGame, createSeedingGame } from "./helpers";
import { produce } from "immer";

describe("getValidActions", () => {
  describe("main phase", () => {
    it("returns pass for the active player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("pass");
      expect(actions[0].playerId).toBe(state.turn.activePlayerId);
    });

    it("returns empty array for non-active player", () => {
      const state = createTestGame();
      const nonActive = state.turnOrder.find(
        (id) => id !== state.turn.activePlayerId,
      )!;
      const actions = getValidActions(state, nonActive);
      expect(actions).toEqual([]);
    });

    it("returns empty array when game has ended", () => {
      const state = produce(createTestGame(), (draft) => {
        draft.phase = "ended";
      });
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions).toEqual([]);
    });

    it("returns empty array for unknown player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, "nonexistent");
      expect(actions).toEqual([]);
    });
  });

  describe("seeding phase", () => {
    it("returns seed_draw at seed_draw step", () => {
      const state = createSeedingGame();
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_draw");
    });

    it("returns seed_keep at seed_keep step", () => {
      const state = produce(createSeedingGame(), (draft) => {
        draft.seedingState!.step = "seed_keep";
      });
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_keep");
    });
  });
});
