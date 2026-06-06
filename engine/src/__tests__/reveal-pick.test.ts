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

// Assumes the current shuffle puts p2 first under SEED="test-seed";
// update if the RNG or shuffle algorithm changes.
const ACTIVE = "p2";
const ACTIVE_IDX = 0;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

function makeAnalyzer(opts: { reveal: number; pick: number }): UnitCard {
  return makeUnit({
    ownerId: ACTIVE,
    actions: [
      {
        name: "analyze",
        apCost: 1,
        effect: `peek(deck)[${opts.reveal}] > pick[${opts.pick}]`,
      },
    ],
  });
}

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
  it("sets pickPrompt instead of moving cards when count < revealed", () => {
    const { state, analyzer, top1, top2, top3 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });
    const ns = next as MainGameState;

    expect(ns.pickPrompt).toEqual({
      kind: "deck_pick",
      playerId: ACTIVE,
      options: [top1.id, top2.id, top3.id],
      count: 1,
      source: "main_deck",
    });
    expect(ns.players[ACTIVE_IDX].hand).toHaveLength(0);
    expect(ns.players[ACTIVE_IDX].mainDeck).toHaveLength(3);
    expect(events.some((e) => e.type === "cards_peeked")).toBe(true);
    expect(events.some((e) => e.type === "cards_revealed")).toBe(false);
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

  it("getVisibleState exposes pickPrompt to the picker", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const vs = getVisibleState(paused, ACTIVE);
    expect(vs.pickPrompt?.kind).toBe("deck_pick");
    expect(vs.pickPrompt?.kind === "deck_pick" && vs.pickPrompt.count).toBe(1);
    expect(vs.pickPrompt?.options).toHaveLength(3);
  });

  it("getVisibleState hides pickPrompt from opponents (peek is private)", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const opponentView = getVisibleState(paused, "p1"); // p1 is non-active
    expect(opponentView.pickPrompt).toBeUndefined();
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

    expect(ns.pickPrompt).toBeUndefined();
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

  it("rejects normal actions while pickPrompt is set", () => {
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

  it("rejects resolve_pick from a player who isn't the pending picker", () => {
    const { state, analyzer, top1 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    // p1 is non-active. applyAction rejects on the active-player check first
    // (it's not p1's turn), so the message we see covers that case.
    expect(() =>
      applyAction(paused, {
        type: "resolve_pick",
        playerId: "p1",
        pickedCardIds: [top1.id],
      }),
    ).toThrow(/player "p1" rejected|pending pick is for/);
  });

  it("rejects resolve_pick when there is no pending pick", () => {
    const state = createTestGame();
    expect(() =>
      applyAction(state, {
        type: "resolve_pick",
        playerId: ACTIVE,
        pickedCardIds: ["any-id"],
      }),
    ).toThrow("no pending pick");
  });

  it("rejects resolve_pick referencing a card no longer in deck (synthetic)", () => {
    // Synthetic: simulate a deck mutation between pause and resolve to verify
    // the defensive throw fires. Can't happen in valid DSL today.
    const { state, analyzer, top2 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });
    const tampered = produce(paused as MainGameState, (d) => {
      d.players[ACTIVE_IDX].mainDeck = d.players[ACTIVE_IDX].mainDeck.filter(
        (c) => c.id !== top2.id,
      );
    });

    expect(() =>
      applyAction(tampered, {
        type: "resolve_pick",
        playerId: ACTIVE,
        pickedCardIds: [top2.id],
      }),
    ).toThrow(/no longer in deck/);
  });

  it("emits a fully-formed cards_picked event on resolve", () => {
    const { state, analyzer, top2 } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const { events } = applyAction(paused, {
      type: "resolve_pick",
      playerId: ACTIVE,
      pickedCardIds: [top2.id],
    });
    const picked = events.find((e) => e.type === "cards_picked");
    expect(picked).toEqual({
      type: "cards_picked",
      playerId: ACTIVE,
      cardIds: [top2.id],
      source: "main_deck",
    });
  });
});

describe("reveal > pick — multi-pick (M > 1)", () => {
  it("getValidActions enumerates C(N, M) resolve_pick subsets", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 2 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const actions = getValidActions(paused, ACTIVE);
    // C(3, 2) = 3 subsets
    expect(actions).toHaveLength(3);
    for (const a of actions) {
      if (a.type !== "resolve_pick") throw new Error("expected resolve_pick only");
      expect(a.pickedCardIds).toHaveLength(2);
      expect(new Set(a.pickedCardIds).size).toBe(2); // no duplicates
    }
    // All subsets distinct
    const keys = actions.map((a) =>
      a.type === "resolve_pick" ? a.pickedCardIds.slice().sort().join(",") : "",
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("resolve_pick with 2 ids moves both, leftover at top of deck in original order", () => {
    const { state, analyzer, top1, top2, top3 } = setupAnalyzeScenario({ reveal: 3, pick: 2 });
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });

    const { state: resolved } = applyAction(paused, {
      type: "resolve_pick",
      playerId: ACTIVE,
      pickedCardIds: [top1.id, top3.id],
    });
    const ns = resolved as MainGameState;

    // top1 + top3 in hand; top2 remains at deck top in original position
    expect(ns.players[ACTIVE_IDX].hand.map((c) => c.id).sort()).toEqual(
      [top1.id, top3.id].sort(),
    );
    expect(ns.players[ACTIVE_IDX].mainDeck.map((c) => c.id)).toEqual([top2.id]);
  });
});

describe("reveal > pick — no choice (forced)", () => {
  it("auto-picks all revealed cards when count >= revealed, no pickPrompt", () => {
    const { state, analyzer, top1, top2 } = setupAnalyzeScenario({ reveal: 2, pick: 2 });
    // mainDeck still has top3 trailing, but reveal[2] only exposes top1+top2

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: analyzer.id,
      actionName: "analyze",
    });
    const ns = next as MainGameState;

    expect(ns.pickPrompt).toBeUndefined();
    expect(ns.players[ACTIVE_IDX].hand.map((c) => c.id).sort()).toEqual(
      [top1.id, top2.id].sort(),
    );
    expect(events.some((e) => e.type === "cards_picked")).toBe(true);
  });
});

describe("DSL validator: terminal pick", () => {
  it("accepts pick as the last step of a chain", () => {
    expect(() => parse("peek(deck)[3] > pick[1]")).not.toThrow();
  });

  it("rejects pick followed by another step in the same chain", () => {
    expect(() => parse("peek(deck)[3] > pick[1] > gold[1]")).toThrow(DSLValidationError);
  });

  it("rejects pick in a non-terminal chain of a + compound", () => {
    // executor would silently drop `draw[1]` after the pause
    expect(() => parse("peek(deck)[3] > pick[1] + draw[1]")).toThrow(DSLValidationError);
  });

  it("accepts pick in the last chain of a + compound", () => {
    // legal: pick is terminal in the last effect of the expression
    expect(() => parse("gold[1] + peek(deck)[3] > pick[1]")).not.toThrow();
  });
});

describe("DSL validator: pick requires a producer", () => {
  it("rejects bare pick with no preceding producer", () => {
    expect(() => parse("pick[1]")).toThrow(DSLValidationError);
  });

  it("rejects pick when the chain's producer is in a different + branch", () => {
    // peek in chain #0 doesn't satisfy pick in chain #1 — `+` is parallel,
    // not a producer relationship
    expect(() => parse("peek(deck)[3] + pick[1]")).toThrow(DSLValidationError);
  });

  it("rejects pick following an unrelated chain step", () => {
    expect(() => parse("gold[1] > pick[1]")).toThrow(DSLValidationError);
  });

  it("error message names the required producer", () => {
    expect(() => parse("pick[1]")).toThrow(/producer.*peek/);
  });
});

describe("DSL validator: positive counts", () => {
  it("rejects peek[0]", () => {
    expect(() => parse("peek(deck)[0] > pick[1]")).toThrow(DSLValidationError);
  });

  it("rejects pick[0]", () => {
    expect(() => parse("peek(deck)[3] > pick[0]")).toThrow(DSLValidationError);
  });
});

describe("getValidActions precondition: peek(deck) with empty deck", () => {
  it("filters out the activate action when the deck is empty", () => {
    // Build a scenario where Ada is on the grid but the deck is empty.
    const analyzer = makeAnalyzer({ reveal: 3, pick: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].units.push(analyzer);
      // d.players[ACTIVE_IDX].mainDeck stays empty
    });

    const actions = getValidActions(state, ACTIVE);
    const ada = actions.filter(
      (a) => a.type === "activate" && a.cardId === analyzer.id,
    );
    expect(ada).toHaveLength(0);
  });

  it("offers the activate action when the deck has cards", () => {
    const { state, analyzer } = setupAnalyzeScenario({ reveal: 3, pick: 1 });
    const actions = getValidActions(state, ACTIVE);
    const ada = actions.filter(
      (a) => a.type === "activate" && a.cardId === analyzer.id,
    );
    expect(ada.length).toBeGreaterThan(0);
  });
});
