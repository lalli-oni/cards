import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import { getVisibleState } from "../visible-state";
import type { MainGameState, UnitCard } from "../types";
import { createTestGame, makeUnit, resetIds } from "./helpers";

beforeEach(() => resetIds());

// Active player under SEED="test-seed" (matches reveal-pick.test.ts).
const ACTIVE = "p2";
const OPPONENT = "p1";
const ACTIVE_IDX = 0;
const OPPONENT_IDX = 1;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

function makeObserver(): UnitCard {
  return makeUnit({
    ownerId: ACTIVE,
    actions: [
      { name: "observe", apCost: 1, effect: "peek(opponent + hand)" },
    ],
  });
}

function setupObserveScenario() {
  const observer = makeObserver();
  const oppCard1 = makeUnit({ ownerId: OPPONENT, name: "OppCard1" });
  const oppCard2 = makeUnit({ ownerId: OPPONENT, name: "OppCard2" });
  const state = gameWith((d) => {
    d.grid[0][0].units.push(observer);
    d.players[OPPONENT_IDX].hand.push(oppCard1, oppCard2);
  });
  return { state, observer, oppCard1, oppCard2 };
}

describe("peek(opponent + hand) — view prompt", () => {
  it("sets viewPrompt with opponent's full hand cards", () => {
    const { state, observer, oppCard1, oppCard2 } = setupObserveScenario();

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });
    const ns = next as MainGameState;

    expect(ns.viewPrompt).toBeDefined();
    expect(ns.viewPrompt?.playerId).toBe(ACTIVE);
    expect(ns.viewPrompt?.source).toBe("opponent_hand");
    expect(ns.viewPrompt?.sourcePlayerId).toBe(OPPONENT);
    expect(ns.viewPrompt?.cards.map((c) => c.id)).toEqual([oppCard1.id, oppCard2.id]);
  });

  it("emits cards_peeked with source=opponent_hand", () => {
    const { state, observer, oppCard1, oppCard2 } = setupObserveScenario();

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    const peeked = events.find((e) => e.type === "cards_peeked");
    expect(peeked).toEqual({
      type: "cards_peeked",
      playerId: ACTIVE,
      cardIds: [oppCard1.id, oppCard2.id],
      source: "opponent_hand",
    });
  });

  it("does not mutate opponent's hand", () => {
    const { state, observer, oppCard1, oppCard2 } = setupObserveScenario();

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });
    const ns = next as MainGameState;

    expect(ns.players[OPPONENT_IDX].hand.map((c) => c.id)).toEqual([
      oppCard1.id,
      oppCard2.id,
    ]);
  });

  it("getVisibleState exposes viewPrompt to the viewer", () => {
    const { state, observer, oppCard1, oppCard2 } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    const vs = getVisibleState(paused, ACTIVE);
    expect(vs.viewPrompt?.source).toBe("opponent_hand");
    expect(vs.viewPrompt?.cards.map((c) => c.id)).toEqual([oppCard1.id, oppCard2.id]);
  });

  it("getVisibleState hides viewPrompt from the opponent", () => {
    const { state, observer } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    const opponentView = getVisibleState(paused, OPPONENT);
    expect(opponentView.viewPrompt).toBeUndefined();
    // Opponent's own hand is still visible to them via self (not redacted).
    expect(opponentView.self.hand).toHaveLength(2);
  });

  it("getValidActions returns only dismiss_view for the viewer while paused", () => {
    const { state, observer } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    const actions = getValidActions(paused, ACTIVE);
    expect(actions).toEqual([{ type: "dismiss_view", playerId: ACTIVE }]);
  });

  it("rejects normal actions while viewPrompt is set", () => {
    const { state, observer } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    expect(() =>
      applyAction(paused, { type: "pass", playerId: ACTIVE }),
    ).toThrow("pending view must be dismissed first");
  });

  it("rejects dismiss_view when there is no pending view", () => {
    const state = createTestGame();
    expect(() =>
      applyAction(state, { type: "dismiss_view", playerId: ACTIVE }),
    ).toThrow("no pending view");
  });

  it("rejects dismiss_view from a player who isn't the pending viewer", () => {
    const { state, observer } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    expect(() =>
      applyAction(paused, { type: "dismiss_view", playerId: OPPONENT }),
    ).toThrow(/player "p1" rejected|pending view is for/);
  });

  it("dismiss_view clears viewPrompt and lets normal play resume", () => {
    const { state, observer } = setupObserveScenario();
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });

    const { state: dismissed } = applyAction(paused, {
      type: "dismiss_view",
      playerId: ACTIVE,
    });
    const ns = dismissed as MainGameState;

    expect(ns.viewPrompt).toBeUndefined();
    // Normal actions should now be available again.
    const actions = getValidActions(dismissed, ACTIVE);
    expect(actions.some((a) => a.type === "pass")).toBe(true);
  });

  it("does not refund AP on dismiss", () => {
    const { state, observer } = setupObserveScenario();
    const apBefore = state.turn.actionPointsRemaining;
    const { state: paused } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: observer.id,
      actionName: "observe",
    });
    const apAfterActivate = (paused as MainGameState).turn.actionPointsRemaining;

    const { state: dismissed } = applyAction(paused, {
      type: "dismiss_view",
      playerId: ACTIVE,
    });
    const ns = dismissed as MainGameState;

    expect(apAfterActivate).toBe(apBefore - 1);
    expect(ns.turn.actionPointsRemaining).toBe(apAfterActivate);
  });
});

describe("Spymaster Infiltrate — view prompt via policy action", () => {
  it("Infiltrate sets viewPrompt with opponent's hand", () => {
    const oppCard = makeUnit({ ownerId: OPPONENT, name: "OppCard" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].activePolicies.push({
        id: "spymaster-inst",
        definitionId: "spymaster",
        type: "policy",
        name: "Spymaster",
        cost: "0",
        rarity: "epic",
        effect: "",
        ownerId: ACTIVE,
      });
      d.players[OPPONENT_IDX].hand.push(oppCard);
    });

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: "spymaster-inst",
      actionName: "Infiltrate",
    });
    const ns = next as MainGameState;

    expect(ns.viewPrompt?.source).toBe("opponent_hand");
    expect(ns.viewPrompt?.cards.map((c) => c.id)).toEqual([oppCard.id]);
  });
});
