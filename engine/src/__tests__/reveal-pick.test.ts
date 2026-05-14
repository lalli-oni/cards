import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { parse } from "../effect-dsl";
import { DSLValidationError } from "../effect-dsl/validate";
import { getValidActions } from "../valid-actions";
import { getVisibleState } from "../visible-state";
import type { MainGameState, UnitCard } from "../types";
import { createTestGame, makeUnit, resetIds } from "./helpers";

beforeEach(() => resetIds());

// With SEED="test-seed", shuffle produces ["p2","p1"].
const ACTIVE = "p2";
const ACTIVE_IDX = 0;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

/** Build a unit with an `analyze` action that reveals N from deck and picks M. */
function makeAnalyzer(opts: { reveal: number; pick: number }): UnitCard {
  return makeUnit({
    ownerId: ACTIVE,
    actions: [
      {
        name: "analyze",
        apCost: 1,
        effect: `reveal(deck)[${opts.reveal}] > pick[${opts.pick}]`,
      },
    ],
  });
}

/** Place an analyzer unit on the grid with a 3-card top-deck setup. */
function setupAnalyzeScenario(opts: { reveal: number; pick: number }) {
  const analyzer = makeAnalyzer(opts);
  const top1 = makeUnit({ ownerId: ACTIVE, name: "Top1" });
  const top2 = makeUnit({ ownerId: ACTIVE, name: "Top2" });
  const top3 = makeUnit({ ownerId: ACTIVE, name: "Top3" });
  const state = gameWith((d) => {
    d.grid[0][0].units.push(analyzer);
    d.players[ACTIVE_IDX].mainDeck.push(top1, top2, top3);
  });
  return { state, analyzer, top1, top2, top3 };
}

describe("reveal > pick — player choice required", () => {
  it("sets pendingPick instead of moving cards when pickCount < revealed", () => {
    const { state, analyzer, top1, top2, top3 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });
    const ns = next as MainGameState;

    expect(ns.pendingPick).toEqual({
      playerId: ACTIVE,
      revealedCardIds: [top1.id, top2.id, top3.id],
      pickCount: 1,
      source: "main_deck",
    });
    expect(ns.players[ACTIVE_IDX].hand).toHaveLength(0);
    expect(ns.players[ACTIVE_IDX].mainDeck).toHaveLength(3);
    expect(events.some((e) => e.type === "cards_revealed")).toBe(true);
    expect(events.some((e) => e.type === "cards_picked")).toBe(false);
  });

  it("getValidActions returns one resolve_pick per candidate, nothing else", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const actions = getValidActions(paused, ACTIVE);
    expect(actions).toHaveLength(3);
    expect(actions.every((a) => a.type === "resolve_pick")).toBe(true);
    const ids = actions.flatMap((a) => (a.type === "resolve_pick" ? a.pickedCardIds : []));
    expect(new Set(ids).size).toBe(3);
  });

  it("getVisibleState exposes pendingPick", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const vs = getVisibleState(paused, ACTIVE);
    expect(vs.pendingPick?.pickCount).toBe(1);
    expect(vs.pendingPick?.revealedCardIds).toHaveLength(3);
  });

  it("resolve_pick moves chosen card to hand and leaves others at top of deck", () => {
    const { state, analyzer, top1, top2, top3 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const { state: resolved, events } = applyAction(paused, {
      type: "resolve_pick",
      playerId: ACTIVE,
      pickedCardIds: [top2.id],
    });
    const ns = resolved as MainGameState;

    expect(ns.pendingPick).toBeUndefined();
    expect(ns.players[ACTIVE_IDX].hand.map((c) => c.id)).toEqual([top2.id]);
    expect(ns.players[ACTIVE_IDX].mainDeck.map((c) => c.id)).toEqual([top1.id, top3.id]);
    expect(events.some((e) => e.type === "cards_picked")).toBe(true);
  });

  it("rejects resolve_pick with wrong count", () => {
    const { state, analyzer, top1, top2 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    expect(() =>
      applyAction(paused, {
        type: "resolve_pick",
        playerId: ACTIVE,
        pickedCardIds: [top1.id, top2.id],
      }),
    ).toThrow("expected 1 cards, got 2");
  });

  it("rejects resolve_pick with duplicate ids", () => {
    const { state, analyzer, top1 } = setupAnalyzeScenario({ reveal: 3, pick: 2 });
    // pick=2 of 3 → choice still required
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    expect(() =>
      applyAction(paused, {
        type: "resolve_pick",
        playerId: ACTIVE,
        pickedCardIds: [top1.id, top1.id],
      }),
    ).toThrow("duplicate card ids");
  });

  it("rejects resolve_pick with an unrevealed card id", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    expect(() =>
      applyAction(paused, {
        type: "resolve_pick",
        playerId: ACTIVE,
        pickedCardIds: ["nonexistent-id"],
      }),
    ).toThrow("not revealed");
  });

  it("rejects normal actions while pendingPick is set", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    expect(() =>
      applyAction(paused, { type: "pass", playerId: ACTIVE }),
    ).toThrow("pending pick must be resolved first");
  });
});

describe("reveal > pick — no choice (forced)", () => {
  it("auto-picks all revealed cards when pickCount >= revealed, no pendingPick", () => {
    const { state, analyzer, top1, top2 } = setupAnalyzeScenario({ reveal: 2, pick: 2 });
    // mainDeck still has top3 trailing, but reveal[2] only exposes top1+top2

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });
    const ns = next as MainGameState;

    expect(ns.pendingPick).toBeUndefined();
    expect(ns.players[ACTIVE_IDX].hand.map((c) => c.id).sort()).toEqual(
      [top1.id, top2.id].sort(),
    );
    expect(events.some((e) => e.type === "cards_picked")).toBe(true);
  });
});

describe("DSL validator: terminal pick", () => {
  it("accepts pick as the last step of a chain", () => {
    expect(() => parse("reveal(deck)[3] > pick[1]")).not.toThrow();
  });

  it("rejects pick followed by another step", () => {
    expect(() => parse("reveal(deck)[3] > pick[1] > gold[1]")).toThrow(DSLValidationError);
  });
});
