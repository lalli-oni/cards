import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import type { MainAction, MainGameState, UnitCard } from "../types";
import { createTestGame, makeItem, makeLocation, makeUnit, resetIds } from "./helpers";

beforeEach(() => resetIds());

// Same active-player assumption as reveal-pick.test.ts — the SEED="test-seed"
// shuffle puts p2 first, so player index 0 is the active player after
// createTestGame() reorders.
const ACTIVE = "p2";
const ACTIVE_IDX = 0;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

function makeHqUnit(name: string, effect: string, apCost = 1): UnitCard {
  return makeUnit({
    ownerId: ACTIVE,
    name,
    actions: [{ name: "act", apCost, effect }],
  });
}

describe("HQ activate — non-positional verbs", () => {
  it("HQ Ada offers analyze (peek+pick) and pauses with pickPrompt", () => {
    const ada = makeHqUnit("Ada", "peek(deck)[3] > pick[1]");
    const top1 = makeUnit({ ownerId: ACTIVE, name: "Top1" });
    const top2 = makeUnit({ ownerId: ACTIVE, name: "Top2" });
    const top3 = makeUnit({ ownerId: ACTIVE, name: "Top3" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(ada);
      d.players[ACTIVE_IDX].mainDeck.push(top1, top2, top3);
    });

    const validActions = getValidActions(state, ACTIVE);
    const activate = validActions.find(
      (a) => a.type === "activate" && a.cardId === ada.id,
    );
    expect(activate).toBeDefined();

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: ada.id,
      actionName: "act",
    });
    const ns = next as MainGameState;
    expect(ns.pickPrompt).toEqual({
      kind: "deck_pick",
      playerId: ACTIVE,
      options: [top1.id, top2.id, top3.id],
      count: 1,
      source: "main_deck",
    });
  });

  it("HQ Tesla offers invent (buy item from market for free)", () => {
    const tesla = makeHqUnit("Tesla", "buy(item)[0]");
    const marketItem = makeItem({ ownerId: ACTIVE, name: "Wrench" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(tesla);
      d.market.push(marketItem);
    });

    const validActions = getValidActions(state, ACTIVE);
    expect(
      validActions.some((a) => a.type === "activate" && a.cardId === tesla.id),
    ).toBe(true);

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: tesla.id,
      actionName: "act",
    });
    const ns = next as MainGameState;
    expect(ns.players[ACTIVE_IDX].hand.some((c) => c.id === marketItem.id)).toBe(true);
    expect(ns.market.some((c) => c.id === marketItem.id)).toBe(false);
    const buyEvent = events.find((e) => e.type === "card_bought");
    expect(buyEvent && "cardName" in buyEvent && buyEvent.cardName).toBe(marketItem.name);
  });

  it("HQ Mansa Musa offers pilgrimage (+5 gold)", () => {
    const mansa = makeHqUnit("Mansa Musa", "gold[5]", 2);
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });
    const goldBefore = state.players[ACTIVE_IDX].gold;

    const validActions = getValidActions(state, ACTIVE);
    expect(
      validActions.some((a) => a.type === "activate" && a.cardId === mansa.id),
    ).toBe(true);

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: mansa.id,
      actionName: "act",
    });
    expect((next as MainGameState).players[ACTIVE_IDX].gold).toBe(goldBefore + 5);
  });

  it("HQ Marco Polo does NOT offer trade-route (compound contains move)", () => {
    const marco = makeHqUnit("Marco Polo", "move(self) + gold[1]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(marco);
    });
    const activates = getValidActions(state, ACTIVE).filter(
      (a) => a.type === "activate" && a.cardId === marco.id,
    );
    expect(activates).toHaveLength(0);
  });

  it("HQ Ramesses II does NOT offer monument (compound contains kill)", () => {
    const ramesses = makeHqUnit("Ramesses II", "vp[1] + kill(self)", 2);
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(ramesses);
    });
    const activates = getValidActions(state, ACTIVE).filter(
      (a) => a.type === "activate" && a.cardId === ramesses.id,
    );
    expect(activates).toHaveLength(0);
  });

  it("HQ Ada does NOT offer analyze when mainDeck is empty (precondition)", () => {
    const ada = makeHqUnit("Ada", "peek(deck)[3] > pick[1]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(ada);
      d.players[ACTIVE_IDX].mainDeck = [];
    });
    const activates = getValidActions(state, ACTIVE).filter(
      (a) => a.type === "activate" && a.cardId === ada.id,
    );
    expect(activates).toHaveLength(0);
  });

  it("Grid Marco Polo regression — trade-route IS offered with an adjacent open cell", () => {
    const marco = makeHqUnit("Marco Polo", "move(self) + gold[1]");
    const state = gameWith((d) => {
      // Place Marco at (0,0); both cells need a location with open facing edges
      // — createTestGame seeds an empty grid.
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE, name: "From" });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE, name: "To" });
      d.grid[0][0].units.push(marco);
    });
    const activates: MainAction[] = getValidActions(state, ACTIVE).filter(
      (a): a is MainAction => a.type === "activate" && a.cardId === marco.id,
    );
    expect(activates.length).toBeGreaterThan(0);
  });
});
