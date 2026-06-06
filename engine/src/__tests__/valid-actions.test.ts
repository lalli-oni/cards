import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import type { EndedGameState, MainGameState } from "../types";
import { getActivePlayerId } from "../types";
import { getValidActions, inferActivateTargets } from "../valid-actions";
import type { BoardPosition } from "../position-helpers";
import { createSeedingGame, createTestGame, makeUnit } from "./helpers";

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
      const nonActive = state.players.map((p) => p.id).find(
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
        scores: {},
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
      const endedState: EndedGameState = { ...base, phase: "ended", scores: {} };
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

describe("inferActivateTargets — HQ origin", () => {
  function setup(opts: { effect: string; deckTopUp?: number } = { effect: "gold[1]" }) {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const unit = makeUnit({
      ownerId: activeId,
      actions: [{ name: "act", apCost: 1, effect: opts.effect }],
    });
    const state = produce(base, (d) => {
      d.players.find((p) => p.id === activeId)!.hq.push(unit);
      if (opts.deckTopUp) {
        const top = d.players.find((p) => p.id === activeId)!;
        for (let i = 0; i < opts.deckTopUp; i++) {
          top.mainDeck.push(makeUnit({ ownerId: activeId, name: `Top${i}` }));
        }
      }
    });
    const hq: BoardPosition = { type: "hq", playerId: activeId };
    return { state: state as MainGameState, unit, activeId, hq };
  }

  it("allows gold[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "gold[1]" });
    expect(inferActivateTargets(state, unit.id, "gold[1]", hq, activeId)).toEqual([{}]);
  });

  it("allows vp[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "vp[1]" });
    expect(inferActivateTargets(state, unit.id, "vp[1]", hq, activeId)).toEqual([{}]);
  });

  it("allows buy(item)[0] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "buy(item)[0]" });
    expect(inferActivateTargets(state, unit.id, "buy(item)[0]", hq, activeId)).toEqual([{}]);
  });

  it("allows peek(deck)[3] > pick[1] when deck has cards", () => {
    const { state, unit, activeId, hq } = setup({
      effect: "peek(deck)[3] > pick[1]",
      deckTopUp: 3,
    });
    expect(
      inferActivateTargets(state, unit.id, "peek(deck)[3] > pick[1]", hq, activeId),
    ).toEqual([{}]);
  });

  it("rejects peek(deck)[3] > pick[1] when deck is empty (precondition gate)", () => {
    const { state, unit, activeId, hq } = setup({ effect: "peek(deck)[3] > pick[1]" });
    expect(
      inferActivateTargets(state, unit.id, "peek(deck)[3] > pick[1]", hq, activeId),
    ).toEqual([]);
  });

  it("rejects kill(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "kill(self)" });
    expect(inferActivateTargets(state, unit.id, "kill(self)", hq, activeId)).toEqual([]);
  });

  it("rejects move(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "move(self)" });
    expect(inferActivateTargets(state, unit.id, "move(self)", hq, activeId)).toEqual([]);
  });

  it("rejects compound vp[1] + kill(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "vp[1] + kill(self)" });
    expect(
      inferActivateTargets(state, unit.id, "vp[1] + kill(self)", hq, activeId),
    ).toEqual([]);
  });

  it("rejects compound move(self) + gold[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "move(self) + gold[1]" });
    expect(
      inferActivateTargets(state, unit.id, "move(self) + gold[1]", hq, activeId),
    ).toEqual([]);
  });
});
