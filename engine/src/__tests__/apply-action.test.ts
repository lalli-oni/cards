import { describe, expect, it } from "bun:test";
import { applyAction } from "../apply-action";
import type { MainGameState } from "../types";
import { createTestGame } from "./helpers";

describe("applyAction", () => {
  describe("active player validation", () => {
    it("rejects actions from non-active player", () => {
      const state = createTestGame();
      // biome-ignore lint/style/noNonNullAssertion: test setup — 2-player game always has a non-active player
      const nonActivePlayer = state.turnOrder.find(
        (id) => id !== state.turn.activePlayerId,
      )!;

      expect(() =>
        applyAction(state, { type: "pass", playerId: nonActivePlayer }),
      ).toThrow("rejected");
    });

    it("accepts actions from active player", () => {
      const state = createTestGame();
      const { state: next } = applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });
      expect(next).toBeDefined();
    });
  });

  describe("pass action", () => {
    it("logs the action", () => {
      const state = createTestGame();
      const { state: next } = applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });
      expect(next.actionLog).toHaveLength(1);
      expect(next.actionLog[0].type).toBe("pass");
    });

    it("advances to the next player", () => {
      const state = createTestGame();
      const firstPlayer = state.turn.activePlayerId;
      const { state: next } = applyAction(state, {
        type: "pass",
        playerId: firstPlayer,
      });
      const nextMain = next as MainGameState;
      expect(nextMain.turn.activePlayerId).not.toBe(firstPlayer);
    });

    it("advances the round when all players have passed", () => {
      const state = createTestGame();
      expect(state.turn.round).toBe(1);

      // First player passes
      const { state: s1 } = applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });
      const s1Main = s1 as MainGameState;
      expect(s1Main.turn.round).toBe(1);

      // Second player passes — round advances
      const { state: s2 } = applyAction(s1, {
        type: "pass",
        playerId: s1Main.turn.activePlayerId,
      });
      const s2Main = s2 as MainGameState;
      expect(s2Main.turn.round).toBe(2);
    });

    it("emits turn_ended and turn_started events", () => {
      const state = createTestGame();
      const { events } = applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });
      expect(events.map((e) => e.type)).toEqual(["turn_ended", "turn_started"]);
    });

    it("wraps turn order back to first player", () => {
      const state = createTestGame();
      const firstPlayer = state.turnOrder[0];

      // Both players pass
      const { state: s1 } = applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });
      const { state: s2 } = applyAction(s1, {
        type: "pass",
        playerId: (s1 as MainGameState).turn.activePlayerId,
      });

      expect((s2 as MainGameState).turn.activePlayerId).toBe(firstPlayer);
    });
  });

  describe("immutability", () => {
    it("does not mutate the original state", () => {
      const state = createTestGame();
      const originalActivePlayer = state.turn.activePlayerId;
      const originalRound = state.turn.round;
      const originalLogLength = state.actionLog.length;

      applyAction(state, {
        type: "pass",
        playerId: state.turn.activePlayerId,
      });

      expect(state.turn.activePlayerId).toBe(originalActivePlayer);
      expect(state.turn.round).toBe(originalRound);
      expect(state.actionLog).toHaveLength(originalLogLength);
    });
  });

  describe("unimplemented actions", () => {
    it("throws for unimplemented action types", () => {
      const state = createTestGame();
      expect(() =>
        applyAction(state, {
          type: "deploy",
          playerId: state.turn.activePlayerId,
          cardId: "some-card",
        }),
      ).toThrow("not yet implemented");
    });
  });
});
