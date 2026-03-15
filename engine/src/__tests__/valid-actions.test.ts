import { describe, expect, it } from "bun:test";
import { getValidActions } from "../valid-actions";
import { createTestGame } from "./helpers";
import { produce } from "immer";

describe("getValidActions", () => {
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
