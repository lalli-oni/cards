import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { rebuildListeners } from "../listeners/rebuild";
import { getModifiedStat } from "../listeners/query";
import type { GameEvent, MainAction, MainGameState, UnitCard } from "../types";
import { getValidActions } from "../valid-actions";
import {
  createTestGame,
  makeInstantEvent,
  makeItem,
  makeLocation,
  makePassiveEvent,
  makePolicy,
  makeTrapEvent,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

// With SEED="test-seed", shuffle produces ["p2","p1"]. If shuffle or hash changes, update these constants.
const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 0;
const OTHER_IDX = 1;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

describe("deploy", () => {
  it("moves a unit from hand to HQ and deducts gold", () => {
    const unit = makeUnit({ ownerId: ACTIVE, cost: "3" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(unit);
      d.players[ACTIVE_IDX].gold = 10;
    });

    const { state: next, events } = applyAction(state, {
      type: "deploy",
      playerId: ACTIVE,
      cardId: unit.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(0);
    expect(p.hq).toHaveLength(1);
    expect(p.hq[0].id).toBe(unit.id);
    expect(p.gold).toBe(7);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "card_deployed")).toBe(true);
  });

  it("moves an item from hand to HQ", () => {
    const item = makeItem({ ownerId: ACTIVE, cost: "0" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(item);
    });

    const { state: next } = applyAction(state, {
      type: "deploy",
      playerId: ACTIVE,
      cardId: item.id,
    });
    const ns = next as MainGameState;
    expect(ns.players[ACTIVE_IDX].hq).toHaveLength(1);
    expect(ns.players[ACTIVE_IDX].hq[0].type).toBe("item");
  });

  it("rejects deploying a non-unit/item card", () => {
    const event = makeInstantEvent({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(event);
    });

    expect(() =>
      applyAction(state, { type: "deploy", playerId: ACTIVE, cardId: event.id }),
    ).toThrow("only units and items");
  });

  it("rejects deploying when gold is insufficient", () => {
    const unit = makeUnit({ ownerId: ACTIVE, cost: "99" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(unit);
      d.players[ACTIVE_IDX].gold = 5;
    });

    expect(() =>
      applyAction(state, { type: "deploy", playerId: ACTIVE, cardId: unit.id }),
    ).toThrow("cannot afford");
  });

  it("rejects deploying a card not in hand", () => {
    const state = createTestGame();
    expect(() =>
      applyAction(state, { type: "deploy", playerId: ACTIVE, cardId: "nonexistent" }),
    ).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// buy
// ---------------------------------------------------------------------------

describe("buy", () => {
  it("purchases a card from market and adds to hand", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "4" });
    const state = gameWith((d) => {
      d.market.push(marketCard);
      d.players[ACTIVE_IDX].gold = 10;
    });

    const { state: next, events } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand.some((c) => c.id === marketCard.id)).toBe(true);
    expect(p.gold).toBe(6);
    expect(ns.turn.actionPointsRemaining).toBe(3); // 0 AP cost
    const buyEvent = events.find((e) => e.type === "card_bought");
    expect(buyEvent).toBeDefined();
    // cardName is carried inline so the renderer can show "P bought X for Yg"
    // even after the card lands in the buyer's (redacted) hand.
    expect(buyEvent && "cardName" in buyEvent && buyEvent.cardName).toBe(marketCard.name);
  });

  it("replenishes market slot from active player's market deck", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "1" });
    const replacementCard = makeItem({ ownerId: "neutral", cost: "2" });
    const state = gameWith((d) => {
      d.market.push(marketCard);
      d.players[ACTIVE_IDX].marketDeck.push(replacementCard);
    });

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    expect(ns.market).toHaveLength(1);
    expect(ns.market[0].id).toBe(replacementCard.id);
  });

  it("applies event draw mechanic — events go to hand", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "0" });
    const eventCard = makeInstantEvent({ ownerId: "neutral" });
    const nonEventCard = makeItem({ ownerId: "neutral", cost: "1" });
    const state = gameWith((d) => {
      d.market.push(marketCard);
      d.players[ACTIVE_IDX].marketDeck.push(eventCard, nonEventCard);
    });

    const { state: next, events } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand.some((c) => c.id === marketCard.id)).toBe(true);
    expect(p.hand.some((c) => c.id === eventCard.id)).toBe(true);
    expect(ns.market[0].id).toBe(nonEventCard.id);
    const drawEvent = events.find((e) => e.type === "card_drawn");
    expect(drawEvent && "cardId" in drawEvent && drawEvent.cardId).toBe(eventCard.id);
  });

  it("supports alternative costs via costIndex", () => {
    const card = makeUnit({ ownerId: "neutral", cost: "10|2" });
    const state = gameWith((d) => {
      d.market.push(card);
      d.players[ACTIVE_IDX].gold = 5;
    });

    expect(() =>
      applyAction(state, { type: "buy", playerId: ACTIVE, cardId: card.id, costIndex: 0 }),
    ).toThrow("cannot afford");

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: card.id,
      costIndex: 1,
    });
    expect((next as MainGameState).players[ACTIVE_IDX].gold).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// draw
// ---------------------------------------------------------------------------

describe("draw", () => {
  it("draws a card from main deck to hand", () => {
    const card = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].mainDeck.push(card);
    });

    const { state: next, events } = applyAction(state, {
      type: "draw",
      playerId: ACTIVE,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(1);
    expect(p.hand[0].id).toBe(card.id);
    expect(p.mainDeck).toHaveLength(0);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    const drawEvent = events.find((e) => e.type === "card_drawn");
    expect(drawEvent).toBeDefined();
    // God view: engine always emits cardId. Per-viewer scrubbing happens
    // downstream in `getVisibleEvent` — see visible-state.test.ts.
    expect(drawEvent && "cardId" in drawEvent && drawEvent.cardId).toBe(card.id);
  });

  it("shuffles discard into main deck when empty", () => {
    const card = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].discardPile.push(card);
    });

    const { state: next, events } = applyAction(state, {
      type: "draw",
      playerId: ACTIVE,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(1);
    expect(p.discardPile).toHaveLength(0);
    expect(events.some((e) => e.type === "deck_shuffled")).toBe(true);
  });

  it("is not a valid action when both deck and discard are empty", () => {
    const state = createTestGame(); // empty decks by default
    const actions = getValidActions(state, ACTIVE);
    expect(actions.some((a) => a.type === "draw")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe("destroy", () => {
  it("removes a card from hand permanently", () => {
    const card = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(card);
    });

    const { state: next, events } = applyAction(state, {
      type: "destroy",
      playerId: ACTIVE,
      cardId: card.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(0);
    expect(p.removedFromGame).toHaveLength(1);
    expect(p.removedFromGame[0].id).toBe(card.id);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "card_destroyed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enter
// ---------------------------------------------------------------------------

describe("enter", () => {
  it("moves a unit from HQ to a perimeter grid cell", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = location;
    });

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(ns.players[ACTIVE_IDX].hq).toHaveLength(0);
    expect(ns.grid[0][0].units).toHaveLength(1);
    expect(ns.grid[0][0].units[0].id).toBe(unit.id);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "unit_entered")).toBe(true);
  });

  it("rejects entering a non-perimeter cell", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[1][1].location = location;
    });

    expect(() =>
      applyAction(state, { type: "enter", playerId: ACTIVE, unitId: unit.id, row: 1, col: 1 }),
    ).toThrow("not on the grid perimeter");
  });

  it("rejects entering when boundary edge is blocked", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({
      ownerId: ACTIVE,
      edges: { n: false, e: false, s: false, w: false },
    });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = location;
    });

    expect(() =>
      applyAction(state, { type: "enter", playerId: ACTIVE, unitId: unit.id, row: 0, col: 0 }),
    ).toThrow("no open edges facing the grid boundary");
  });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("move", () => {
  it("moves a unit to an adjacent cell with open facing edges", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
    });

    const { state: next, events } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 1,
    });
    const ns = next as MainGameState;

    expect(ns.grid[0][0].units).toHaveLength(0);
    expect(ns.grid[0][1].units).toHaveLength(1);
    expect(ns.grid[0][1].units[0].id).toBe(unit.id);
    expect(events.some((e) => e.type === "unit_moved")).toBe(true);
  });

  it("first move under Pioneer policy costs 0 AP", () => {
    // Regression for #104: handleMove now uses getModifiedAPCost in the
    // regular branch, matching the retreat branch and getValidActions.
    // Previously the regular branch used raw AP cost, which made the
    // pioneer policy's free-first-move discount inconsistent (validation
    // accepted the move, apply threw "Not enough AP").
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
      d.players[ACTIVE_IDX].activePolicies.push(
        makePolicy({ ownerId: ACTIVE, definitionId: "pioneer" }),
      );
      d.turn.actionPointsRemaining = 0; // would normally reject; pioneer makes it free
    });

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 1,
    });
    const ns = next as MainGameState;
    expect(ns.grid[0][1].units[0].id).toBe(unit.id);
    expect(ns.turn.actionPointsRemaining).toBe(0); // still 0 — was free
  });

  it("rejects move when facing edges are blocked", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({
        ownerId: ACTIVE,
        edges: { n: true, e: false, s: true, w: true },
      });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
    });

    expect(() =>
      applyAction(state, { type: "move", playerId: ACTIVE, unitId: unit.id, row: 0, col: 1 }),
    ).toThrow("blocked");
  });

  it("costs 2 AP for injured units", () => {
    const unit = makeUnit({ ownerId: ACTIVE, injured: true });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
    });

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 1,
    });
    expect((next as MainGameState).turn.actionPointsRemaining).toBe(1); // 3 - 2
  });

  it("allows retreat to HQ from perimeter with open boundary edge, carrying equipped items", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    // Equipped item exercises the shared `retreatUnitsToHQ` item-move loop on the
    // Move-action (single-unit) path — the combat retreat covers it separately.
    const sword = makeItem({ ownerId: ACTIVE, equippedTo: unit.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(sword);
    });
    const apBefore = (state as MainGameState).turn.actionPointsRemaining;

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: -1,
      col: -1,
    });
    const ns = next as MainGameState;

    expect(ns.grid[0][0].units).toHaveLength(0);
    expect(ns.grid[0][0].items).toHaveLength(0);
    expect(ns.players[ACTIVE_IDX].hq.some((c) => c.id === unit.id)).toBe(true);
    // The item travels to HQ with its unit.
    expect(ns.players[ACTIVE_IDX].hq.some((c) => c.id === sword.id)).toBe(true);
    // Unlike the combat retreat, the Move-action retreat costs 1 AP.
    expect(ns.turn.actionPointsRemaining).toBe(apBefore - 1);
  });
});

// ---------------------------------------------------------------------------
// play_event
// ---------------------------------------------------------------------------

describe("play_event", () => {
  it("plays an instant event and discards it", () => {
    const event = makeInstantEvent({ ownerId: ACTIVE, cost: "0" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(event);
    });

    const { state: next, events } = applyAction(state, {
      type: "play_event",
      playerId: ACTIVE,
      cardId: event.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(0);
    expect(p.discardPile).toHaveLength(1);
    expect(events.some((e) => e.type === "event_played")).toBe(true);
  });

  it("plays a passive event with duration tracking", () => {
    const event = makePassiveEvent({ ownerId: ACTIVE, cost: "0", duration: 3 });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(event);
    });

    const { state: next } = applyAction(state, {
      type: "play_event",
      playerId: ACTIVE,
      cardId: event.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(0);
    expect(p.passiveEvents).toHaveLength(1);
    expect(p.passiveEvents[0].remainingDuration).toBe(3);
  });

  it("plays a trap event face-down", () => {
    const event = makeTrapEvent({ ownerId: ACTIVE, cost: "0", trigger: "manual" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(event);
    });

    const { state: next, events } = applyAction(state, {
      type: "play_event",
      playerId: ACTIVE,
      cardId: event.id,
      targetId: "some-target",
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand).toHaveLength(0);
    expect(p.activeTraps).toHaveLength(1);
    expect(p.activeTraps[0].card.id).toBe(event.id);
    expect(p.activeTraps[0].targetId).toBe("some-target");
    expect(events.some((e) => e.type === "trap_set")).toBe(true);
  });

  // Full chain (enumerate → apply) for the location-targeting cards. Guards
  // against a regression where the enumeration emits the wrong field name and
  // handlePlayEvent silently drops it.

  it("Highway Robbery: enumerated play_event stores targetId on the trap", () => {
    const targetLoc = makeLocation({ ownerId: ACTIVE });
    const otherLoc = makeLocation({ ownerId: ACTIVE });
    const trap = makeTrapEvent({
      ownerId: ACTIVE,
      definitionId: "highway-robbery",
      trigger: "enemy_unit_enters_location",
      cost: "0",
    });
    const state = gameWith((d) => {
      d.grid[0][1].location = targetLoc;
      d.grid[0][3].location = otherLoc;
      d.players[ACTIVE_IDX].hand.push(trap);
    });

    const valid = getValidActions(state, ACTIVE);
    const targetAction = valid.find(
      (a): a is Extract<typeof a, { type: "play_event" }> =>
        a.type === "play_event" && a.cardId === trap.id && a.targetId === targetLoc.id,
    );
    expect(targetAction).toBeDefined();

    const { state: next } = applyAction(state, targetAction!);
    const ns = next as MainGameState;
    expect(ns.players[ACTIVE_IDX].activeTraps).toHaveLength(1);
    expect(ns.players[ACTIVE_IDX].activeTraps[0].targetId).toBe(targetLoc.id);
  });

  it("Plague: enumerated play_event stores targetId on the passive and stat query resolves", () => {
    const targetLoc = makeLocation({ ownerId: ACTIVE });
    const plague = makePassiveEvent({
      ownerId: ACTIVE,
      definitionId: "plague",
      cost: "0",
      duration: 99,
    });
    const state = gameWith((d) => {
      d.grid[1][1].location = targetLoc;
      d.grid[2][2].location = makeLocation({ ownerId: ACTIVE });
      d.players[ACTIVE_IDX].hand.push(plague);
    });

    const valid = getValidActions(state, ACTIVE);
    const targetAction = valid.find(
      (a): a is Extract<typeof a, { type: "play_event" }> =>
        a.type === "play_event" && a.cardId === plague.id && a.targetId === targetLoc.id,
    );
    expect(targetAction).toBeDefined();

    const { state: next } = applyAction(state, targetAction!);
    const ns = next as MainGameState;
    expect(ns.players[ACTIVE_IDX].passiveEvents).toHaveLength(1);
    expect(ns.players[ACTIVE_IDX].passiveEvents[0].targetId).toBe(targetLoc.id);

    const { queries } = rebuildListeners(ns);
    const unit = makeUnit({ ownerId: ACTIVE, strength: 5 });
    expect(getModifiedStat(ns, queries, unit, "strength", { row: 1, col: 1 })).toBe(3);
  });

  it("rejects play_event without targetId when the card needs a location target", () => {
    const trap = makeTrapEvent({
      ownerId: ACTIVE,
      definitionId: "highway-robbery",
      trigger: "enemy_unit_enters_location",
      cost: "0",
    });
    const state = gameWith((d) => {
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.players[ACTIVE_IDX].hand.push(trap);
    });

    expect(() =>
      applyAction(state, {
        type: "play_event",
        playerId: ACTIVE,
        cardId: trap.id,
      }),
    ).toThrow("requires a location targetId");
  });

  it("rejects play_event without targetId for Plague (passive needing target)", () => {
    const plague = makePassiveEvent({
      ownerId: ACTIVE,
      definitionId: "plague",
      cost: "0",
      duration: 99,
    });
    const state = gameWith((d) => {
      d.grid[1][1].location = makeLocation({ ownerId: ACTIVE });
      d.players[ACTIVE_IDX].hand.push(plague);
    });

    expect(() =>
      applyAction(state, {
        type: "play_event",
        playerId: ACTIVE,
        cardId: plague.id,
      }),
    ).toThrow("requires a location targetId");
  });
});

// ---------------------------------------------------------------------------
// equip
// ---------------------------------------------------------------------------

describe("equip", () => {
  it("equips an item in HQ to a unit in HQ", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const item = makeItem({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit, item);
    });

    const { state: next, events } = applyAction(state, {
      type: "equip",
      playerId: ACTIVE,
      itemId: item.id,
      unitId: unit.id,
    });
    const ns = next as MainGameState;
    const equipped = ns.players[ACTIVE_IDX].hq.find((c) => c.id === item.id);

    expect(equipped?.type).toBe("item");
    expect((equipped as any).equippedTo).toBe(unit.id);
    expect(events.some((e) => e.type === "item_equipped")).toBe(true);
  });

  it("rejects equipping when unit and item are not co-located", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const item = makeItem({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].items.push(item);
    });

    expect(() =>
      applyAction(state, { type: "equip", playerId: ACTIVE, itemId: item.id, unitId: unit.id }),
    ).toThrow("not co-located");
  });
});

// ---------------------------------------------------------------------------
// raze
// ---------------------------------------------------------------------------

describe("raze", () => {
  it("destroys a location and all cards there", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: ACTIVE });
    const replacement = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(unit);
      d.players[ACTIVE_IDX].prospectDeck.push(replacement);
    });

    const { state: next, events } = applyAction(state, {
      type: "raze",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(ns.players[ACTIVE_IDX].discardPile.length).toBeGreaterThan(0);
    expect(ns.grid[0][0].location?.id).toBe(replacement.id);
    expect(ns.grid[0][0].units).toHaveLength(0);
    // Raze costs 3 AP (all AP), but no auto-advance — player must pass
    expect(ns.turn.actionPointsRemaining).toBe(0);
    expect(events.some((e) => e.type === "location_razed")).toBe(true);
    expect(events.some((e) => e.type === "location_placed")).toBe(true);
  });

  it("rejects raze when enemy units are present", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const enemy = makeUnit({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit, enemy);
    });

    expect(() =>
      applyAction(state, { type: "raze", playerId: ACTIVE, unitId: unit.id, row: 0, col: 0 }),
    ).toThrow("enemy units present");
  });
});

// ---------------------------------------------------------------------------
// attack
// ---------------------------------------------------------------------------

describe("attack", () => {
  it("resolves combat between units at same location", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.map((e) => e.type)).toContain("combat_started");
    expect(events.map((e) => e.type)).toContain("combat_resolved");
    expect(ns.turn.actionPointsRemaining).toBe(2);
  });

  it("rejects attack with no enemy units", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
    });

    expect(() =>
      applyAction(state, { type: "attack", playerId: ACTIVE, unitIds: [unit.id], row: 0, col: 0 }),
    ).toThrow("No enemy units");
  });

  // Empty unitIds is now a compile-time error via [string, ...string[]] tuple type

  it("kills a vastly weaker defender", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const p1 = ns.players[OTHER_IDX];

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(p1.discardPile.some((c) => c.id === defender.id)).toBe(true);
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// defender-assigned matchups (#166)
// ---------------------------------------------------------------------------
//
// Per rules step 4 the defender pairs units "after seeing all rolls", so combat
// suspends *within* a round — after the roll, before resolution — whenever the
// defender has a real pairing choice (min(sides) >= 2). A 2-vs-2 with widely
// separated strengths is the canonical case: As (str 100) always outpowers
// Aw (str 1) and Ds always outpowers Dw regardless of the d6, so the roll-sorted
// participant order is deterministic — [As, Aw] vs [Ds, Dw] — and the greedy
// default pairs As↔Ds / Aw↔Dw. The defender may instead cross them (As↔Dw,
// Aw↔Ds), which the engine must honor.
describe("defender-assigned matchups (#166)", () => {
  function suspendingCombat(): {
    state: MainGameState;
    strongAtk: string;
    weakAtk: string;
    strongDef: string;
    weakDef: string;
  } {
    const strongAtk = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const weakAtk = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const strongDef = makeUnit({ ownerId: OTHER, strength: 100 });
    const weakDef = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(strongAtk, weakAtk, strongDef, weakDef);
    });
    return {
      state,
      strongAtk: strongAtk.id,
      weakAtk: weakAtk.id,
      strongDef: strongDef.id,
      weakDef: weakDef.id,
    };
  }

  const attackAction = { type: "attack" as const, playerId: ACTIVE, row: 0, col: 0 };

  /** Attack with both attackers and return the suspended state. */
  function attackAndSuspend(s: ReturnType<typeof suspendingCombat>): MainGameState {
    const { state } = applyAction(s.state, {
      ...attackAction,
      unitIds: [s.strongAtk, s.weakAtk],
    });
    return state as MainGameState;
  }

  /** The defender-side ids each attacker was actually paired against, from the
   *  first (round-0) pair-resolved events. */
  function round0Pairing(events: GameEvent[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const e of events) {
      if (e.type === "combat_pair_resolved" && !(e.attacker.unitId in map)) {
        map[e.attacker.unitId] = e.defender.unitId;
      }
    }
    return map;
  }

  it("suspends at round 0 for the defender's matchup decision, before resolving", () => {
    const s = suspendingCombat();
    const { state: next, events } = applyAction(s.state, {
      ...attackAction,
      unitIds: [s.strongAtk, s.weakAtk],
    });
    const ns = next as MainGameState;

    // Combat began and paused. Unlike #165's between-rounds suspend, NOTHING is
    // resolved before the pause — the roll is revealed, resolution waits.
    expect(events.map((e) => e.type)).toContain("combat_started");
    expect(events.some((e) => e.type === "combat_resolved")).toBe(false);
    expect(events.some((e) => e.type === "combat_pair_resolved")).toBe(false);

    // The prompt hands the decision to the defender (the non-active player) and
    // carries the round's revealed rolls for both participating sides.
    expect(ns.combatPrompt).toBeDefined();
    expect(ns.combatPrompt?.round).toBe(0);
    expect(ns.combatPrompt?.playerId).toBe(OTHER);
    expect(ns.combatPrompt?.attackerId).toBe(ACTIVE);
    expect(ns.combatPrompt?.defenderId).toBe(OTHER);
    expect(ns.combatPrompt?.atkRolls.map((r) => r.unitId)).toEqual([s.strongAtk, s.weakAtk]);
    expect(ns.combatPrompt?.defRolls.map((r) => r.unitId)).toEqual([s.strongDef, s.weakDef]);

    // AP was spent up front on the initiating attack (not on resume).
    expect(ns.turn.actionPointsRemaining).toBe(2);
  });

  it("lets the non-active defender submit the assignment and resolve", () => {
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);

    // The defender (OTHER) is not the active player, yet may resolve.
    const decision = getValidActions(suspended, OTHER)[0];
    expect(decision).toMatchObject({ type: "resolve_combat_round", playerId: OTHER });

    let cur = suspended;
    const events: GameEvent[] = [];
    let guard = 0;
    while (cur.combatPrompt) {
      if (guard++ > 10) throw new Error("combat failed to terminate");
      const r = applyAction(cur, getValidActions(cur, cur.combatPrompt.playerId)[0] as MainAction);
      cur = r.state as MainGameState;
      events.push(...r.events);
    }

    expect(cur.combatPrompt).toBeUndefined();
    expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(1);
    expect(events.filter((e) => e.type === "combat_started")).toHaveLength(0); // started fired pre-suspend
  });

  it("honors a non-greedy assignment that diverges from the greedy default", () => {
    // Greedy default pairs strong↔strong; the defender instead crosses the
    // matchups (strong attacker vs weak defender, weak attacker vs strong
    // defender). The engine must resolve the pairs the defender chose. Both
    // decisions are applied to the same immutable suspended state, so unit ids
    // (and rolls) match and the pairings are directly comparable.
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);

    const greedyRun = applyAction(suspended, getValidActions(suspended, OTHER)[0] as MainAction);
    const greedyPairing = round0Pairing(greedyRun.events);

    const crossedRun = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: s.strongAtk, defenderUnitId: s.weakDef },
          { attackerUnitId: s.weakAtk, defenderUnitId: s.strongDef },
        ],
      },
    });
    const crossedPairing = round0Pairing(crossedRun.events);

    // Greedy paired the strong attacker against the strong defender; the
    // defender's crossed assignment paired it against the weak defender instead.
    expect(greedyPairing[s.strongAtk]).toBe(s.strongDef);
    expect(crossedPairing[s.strongAtk]).toBe(s.weakDef);
    expect(crossedPairing[s.weakAtk]).toBe(s.strongDef);
    expect(crossedPairing).not.toEqual(greedyPairing);
  });

  it("rejects resolve_combat_round from a non-decider", () => {
    // The decider is the defender (OTHER); the active attacker (ACTIVE) clears
    // the turn-ownership gate but is rejected by the handler's decider guard.
    const suspended = attackAndSuspend(suspendingCombat());
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "assign_matchups", pairs: [] },
      }),
    ).toThrow("pending combat decision is for");
  });

  it("rejects resolve_combat_round when no combat is suspended", () => {
    const state = gameWith(() => {});
    expect(() =>
      applyAction(state, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "assign_matchups", pairs: [] },
      }),
    ).toThrow("no suspended combat");
  });

  it("rejects an assignment with the wrong pair count", () => {
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [{ attackerUnitId: s.strongAtk, defenderUnitId: s.strongDef }],
        },
      }),
    ).toThrow("expected 2 matchup(s), got 1");
  });

  it("rejects an assignment naming a non-participant unit", () => {
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: s.strongDef },
            { attackerUnitId: "ghost", defenderUnitId: s.weakDef },
          ],
        },
      }),
    ).toThrow('attacker "ghost" is not a participant');
  });

  it("rejects an assignment that pairs a unit twice", () => {
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: s.strongDef },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.strongDef },
          ],
        },
      }),
    ).toThrow("is paired more than once");
  });

  it("rejects an assignment naming a non-participant defender", () => {
    // Mirror of the attacker-side check, but the ghost id is in the defender
    // slot so the `!defSide` branch throws.
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: "ghost" },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.weakDef },
          ],
        },
      }),
    ).toThrow('defender "ghost" is not a participant');
  });

  it("rejects an assignment placing a real unit on the wrong side", () => {
    // `strongDef` is a real unit but a DEFENDER — it is not an attacker
    // participant, so naming it in the attacker slot is rejected.
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongDef, defenderUnitId: s.weakDef },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.strongDef },
          ],
        },
      }),
    ).toThrow(`attacker "${s.strongDef}" is not a participant`);
  });

  it("rejects an assignment when a participant left the cell before resume", () => {
    // Defensive path: the dispatch gate normally freezes the board while a
    // combat is suspended, but if a stashed participant is gone at resume,
    // `combatantRollFromSide` refuses to reconstruct its roll.
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    const tampered = produce(suspended, (d) => {
      const cell = d.grid[0][0];
      cell.units = cell.units.filter((u) => u.id !== s.strongDef);
    });
    expect(() =>
      applyAction(tampered, {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: s.strongDef },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.weakDef },
          ],
        },
      }),
    ).toThrow(`participant "${s.strongDef}" is no longer at the cell`);
  });

  it("persists the rng stream across the suspend boundary and reuses the shown rolls", () => {
    const s = suspendingCombat();
    const preAttackRng = s.state.rngState;
    const suspended = attackAndSuspend(s);

    // The dice were rolled before the pause, and that rng advance was persisted
    // on the suspended state — so the resumed round cannot replay round 0's seed.
    expect(suspended.rngState).not.toEqual(preAttackRng);

    // Resolving reuses the exact rolls the defender saw (no re-roll): the
    // round-0 pair events carry the rolls stored on the prompt.
    const shown = new Map(
      suspended.combatPrompt!.atkRolls.map((r) => [r.unitId, r.roll]),
    );
    const { events } = applyAction(
      suspended,
      getValidActions(suspended, OTHER)[0] as MainAction,
    );
    const round0 = events
      .filter((e) => e.type === "combat_pair_resolved")
      .slice(0, 2);
    expect(round0).toHaveLength(2);
    for (const e of round0) {
      if (e.type !== "combat_pair_resolved") continue;
      const shownRoll = shown.get(e.attacker.unitId);
      expect(shownRoll).toBeDefined();
      expect(e.attacker.roll).toBe(shownRoll as number);
    }
  });

  it("emits plain combat sides on resume (no revoked draft proxies leak into events)", () => {
    // The stashed rolls live on `draft.combatPrompt`; before snapshotting them
    // out of the draft, `toCombatSide` copied `modifiers` by reference, so the
    // emitted event held a draft proxy that was revoked once produce() finished
    // — any later reader (the event log) then threw "proxy revoked".
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);
    const { events } = applyAction(
      suspended,
      getValidActions(suspended, OTHER)[0] as MainAction,
    );
    const pair = events.find((e) => e.type === "combat_pair_resolved");
    expect(pair).toBeDefined();
    if (pair?.type !== "combat_pair_resolved") return;
    // Traversing the side (as JSON serialization / the event log does) must not
    // throw on a revoked proxy.
    expect(() => JSON.stringify(pair.attacker)).not.toThrow();
    expect(() => JSON.stringify(pair.defender)).not.toThrow();
    expect(Array.isArray(pair.attacker.modifiers)).toBe(true);
  });

  it("resolves to the correct winner after the defender assigns matchups", () => {
    // Two str-100 attackers vs two str-1 defenders: min=2 so it suspends, and
    // any greedy pairing (101+ vs 7-max) means the attacker always wins — a
    // deterministic winner the resume path must report.
    const atk1 = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const atk2 = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const def1 = makeUnit({ ownerId: OTHER, strength: 1 });
    const def2 = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atk1, atk2, def1, def2);
    });
    const { state: suspended } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      row: 0,
      col: 0,
      unitIds: [atk1.id, atk2.id],
    });
    const susp = suspended as MainGameState;
    expect(susp.combatPrompt).toBeDefined();

    const { events } = applyAction(
      susp,
      getValidActions(susp, OTHER)[0] as MainAction,
    );
    const resolved = events.filter((e) => e.type === "combat_resolved");
    expect(resolved).toHaveLength(1);
    const ev = resolved[0];
    if (ev.type === "combat_resolved") {
      expect(ev.winnerId).toBe(ACTIVE);
    }
  });

  it("rejects any non-resolver action while combat is suspended", () => {
    const suspended = attackAndSuspend(suspendingCombat());
    expect(() =>
      applyAction(suspended, { type: "pass", playerId: ACTIVE }),
    ).toThrow("suspended combat must be resolved first");
  });

  it("offers every matchup bijection to the decider, greedy default first, nothing to others", () => {
    const s = suspendingCombat();
    const suspended = attackAndSuspend(s);

    // 2v2: the defender is offered both bijections so bots/search can explore
    // non-greedy pairings. The identity permutation (strong↔strong) is first —
    // the greedy auto-resolve default a bot can submit as-is.
    const offered = getValidActions(suspended, OTHER);
    expect(offered).toEqual([
      {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: s.strongDef },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.weakDef },
          ],
        },
      },
      {
        type: "resolve_combat_round",
        playerId: OTHER,
        decision: {
          kind: "assign_matchups",
          pairs: [
            { attackerUnitId: s.strongAtk, defenderUnitId: s.weakDef },
            { attackerUnitId: s.weakAtk, defenderUnitId: s.strongDef },
          ],
        },
      },
    ]);
    // The active attacker gets nothing while it waits on the defender.
    expect(getValidActions(suspended, ACTIVE)).toEqual([]);
  });

  it("enumerates all n! bijections for a 3v3, greedy default first", () => {
    // Strengths far enough apart that the d6 roll can't reorder the power sort,
    // so the greedy default (identity permutation) is deterministic.
    const a100 = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const a50 = makeUnit({ ownerId: ACTIVE, strength: 50 });
    const a1 = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const d100 = makeUnit({ ownerId: OTHER, strength: 100 });
    const d50 = makeUnit({ ownerId: OTHER, strength: 50 });
    const d1 = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(a100, a50, a1, d100, d50, d1);
    });
    const { state: suspended } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      row: 0,
      col: 0,
      unitIds: [a100.id, a50.id, a1.id],
    });
    const susp = suspended as MainGameState;
    expect(susp.combatPrompt).toBeDefined();

    const offered = getValidActions(susp, OTHER);
    expect(offered).toHaveLength(6); // 3!
    // Greedy default first: highest-vs-highest by power.
    expect(offered[0]).toMatchObject({
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: a100.id, defenderUnitId: d100.id },
          { attackerUnitId: a50.id, defenderUnitId: d50.id },
          { attackerUnitId: a1.id, defenderUnitId: d1.id },
        ],
      },
    });
    // Every offer is a well-formed 3-pair bijection over the defenders.
    for (const act of offered) {
      if (act.type !== "resolve_combat_round") continue;
      if (act.decision.kind !== "assign_matchups") continue;
      expect(act.decision.pairs).toHaveLength(3);
      expect(new Set(act.decision.pairs.map((p) => p.defenderUnitId)).size).toBe(3);
    }
  });

  it("suspends for a sit-out choice when one side has excess (1 attacker vs 3 defenders)", () => {
    // 1-vs-3: min(1,3) = 1, so there is no *pairing* choice — but the defender
    // (the larger side) must pick which 2 of its 3 units sit out (#167). Combat
    // suspends for that sit-out decision, then the lone 1-vs-1 resolves.
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const defenders = [
      makeUnit({ ownerId: OTHER, strength: 1 }),
      makeUnit({ ownerId: OTHER, strength: 1 }),
      makeUnit({ ownerId: OTHER, strength: 1 }),
    ];
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, ...defenders);
    });

    const { state: suspended } = applyAction(state, {
      ...attackAction,
      unitIds: [attacker.id],
    });
    let cur = suspended as MainGameState;

    // Suspended for the defender's sit-out choice, not resolved.
    expect(cur.combatPrompt?.kind).toBe("sit_out");
    expect(cur.combatPrompt?.playerId).toBe(OTHER); // the larger (defending) side decides
    expect(cur.combatPrompt?.defRolls).toHaveLength(3);
    expect(cur.combatPrompt?.atkRolls).toHaveLength(1);

    const events: GameEvent[] = [];
    let guard = 0;
    while (cur.combatPrompt) {
      if (guard++ > 10) throw new Error("combat failed to terminate");
      const r = applyAction(cur, getValidActions(cur, cur.combatPrompt.playerId)[0] as MainAction);
      cur = r.state as MainGameState;
      events.push(...r.events);
    }

    expect(cur.combatPrompt).toBeUndefined();
    expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(1);
  });

  it("throws if multiple prompts are set at once (mutual-exclusion invariant)", () => {
    // combatPrompt / pickPrompt / viewPrompt are mutually exclusive; a producer
    // that co-sets two must fail loud at dispatch rather than deadlock.
    const state = gameWith((d) => {
      d.combatPrompt = {
        kind: "assign_matchups",
        playerId: ACTIVE,
        row: 0,
        col: 0,
        attackerId: ACTIVE,
        defenderId: OTHER,
        round: 1,
        attackerUnitIds: [],
        defenderUnitIds: [],
        atkRolls: [],
        defRolls: [],
      };
      d.pickPrompt = {
        playerId: ACTIVE,
        kind: "deck_pick",
        count: 1,
        options: ["a", "b"],
        source: "main_deck",
      };
    });

    expect(() =>
      applyAction(state, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "assign_matchups", pairs: [] },
      }),
    ).toThrow("multiple prompts are set");
  });
});

// ---------------------------------------------------------------------------
// sit-out selection (#167)
// ---------------------------------------------------------------------------

describe("sit-out selection (#167)", () => {
  const attackAction = { type: "attack" as const, playerId: ACTIVE, row: 0, col: 0 };

  /** Drive the fight to completion via the greedy default (`[0]`) at each
   *  suspend, collecting every event. Returns the terminal state + events. */
  function runToEnd(suspended: MainGameState): { state: MainGameState; events: GameEvent[] } {
    let cur = suspended;
    const events: GameEvent[] = [];
    let guard = 0;
    while (cur.combatPrompt) {
      if (guard++ > 10) throw new Error("combat failed to terminate");
      const r = applyAction(cur, getValidActions(cur, cur.combatPrompt.playerId)[0] as MainAction);
      cur = r.state as MainGameState;
      events.push(...r.events);
    }
    return { state: cur, events };
  }

  it("hands the sit-out choice to the larger (attacking) side and resolves the remainder", () => {
    // 3 attackers vs 1 defender: the attacker is the larger side and must drop 2
    // excess units. A non-greedy choice (sit out the two strongest) proves the
    // engine honors the submitted ids rather than trimming lowest-power itself.
    const atkStrong = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const atkMid = makeUnit({ ownerId: ACTIVE, strength: 50 });
    const atkWeak = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atkStrong, atkMid, atkWeak, defender);
    });

    const { state: next } = applyAction(state, {
      ...attackAction,
      unitIds: [atkStrong.id, atkMid.id, atkWeak.id],
    });
    const suspended = next as MainGameState;

    // Suspended for the attacker's sit-out choice, before any resolution.
    expect(suspended.combatPrompt?.kind).toBe("sit_out");
    expect(suspended.combatPrompt?.playerId).toBe(ACTIVE);
    expect(suspended.combatPrompt?.atkRolls).toHaveLength(3);
    expect(suspended.combatPrompt?.defRolls).toHaveLength(1);

    // Sit out the two strongest, keeping the weak attacker to fight.
    const { state: resolved, events } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "sit_out", sitOutUnitIds: [atkStrong.id, atkMid.id] },
    });
    const ns = resolved as MainGameState;

    // One clean resolution, no lingering prompt.
    expect(ns.combatPrompt).toBeUndefined();
    expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(1);

    // The kept (weak) attacker is the one that fought the defender.
    const pair = events.find((e) => e.type === "combat_pair_resolved");
    expect(pair && pair.type === "combat_pair_resolved" && pair.attacker.unitId).toBe(atkWeak.id);

    // Both sat-out attackers are untouched and still present.
    expect(ns.grid[0][0].units.some((u) => u.id === atkStrong.id)).toBe(true);
    expect(ns.grid[0][0].units.some((u) => u.id === atkMid.id)).toBe(true);
  });

  it("rejects a sit-out that drops the wrong count or a non-excess unit", () => {
    const atk1 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const atk2 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 10 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atk1, atk2, defender);
    });
    const { state: next } = applyAction(state, {
      ...attackAction,
      unitIds: [atk1.id, atk2.id],
    });
    const suspended = next as MainGameState;
    expect(suspended.combatPrompt?.kind).toBe("sit_out");

    // Wrong count: excess is 1, not 2.
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "sit_out", sitOutUnitIds: [atk1.id, atk2.id] },
      }),
    ).toThrow("expected 1 sit-out");

    // A unit not on the larger side cannot be told to sit out.
    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "sit_out", sitOutUnitIds: [defender.id] },
      }),
    ).toThrow("not an excess unit");
  });

  it("rejects a sit-out that names the same unit twice", () => {
    // 3-vs-1 (excess 2): a duplicate id has the right *count*, so it slips past
    // the count guard and must be caught by the distinctness check — otherwise it
    // would sit out one unit and leave the round a unit short.
    const atk1 = makeUnit({ ownerId: ACTIVE, strength: 30 });
    const atk2 = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const atk3 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atk1, atk2, atk3, defender);
    });
    const { state: next } = applyAction(state, {
      ...attackAction,
      unitIds: [atk1.id, atk2.id, atk3.id],
    });
    const suspended = next as MainGameState;

    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "sit_out", sitOutUnitIds: [atk1.id, atk1.id] },
      }),
    ).toThrow("sits out more than once");
  });

  it("rejects a decision whose kind does not match the pending prompt", () => {
    // A sit_out prompt must not accept an assign_matchups payload (or vice versa):
    // the kind guard fails loud rather than routing the wrong payload into the
    // wrong resolver.
    const atk1 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const atk2 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 10 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atk1, atk2, defender);
    });
    const { state: next } = applyAction(state, {
      ...attackAction,
      unitIds: [atk1.id, atk2.id],
    });
    const suspended = next as MainGameState;
    expect(suspended.combatPrompt?.kind).toBe("sit_out");

    expect(() =>
      applyAction(suspended, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "assign_matchups", pairs: [] },
      }),
    ).toThrow('expected a "sit_out" decision');
  });

  it("suspends twice in one round: sit-out first, then the matchup decision (3v2)", () => {
    // 3 attackers vs 2 defenders. The attacker drops 1 excess (sit-out), leaving
    // 2v2 — which then needs the defender's matchup pairing. Both decisions fire
    // within the SAME round before any pair resolves.
    const atkA = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const atkB = makeUnit({ ownerId: ACTIVE, strength: 50 });
    const atkC = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defA = makeUnit({ ownerId: OTHER, strength: 100 });
    const defB = makeUnit({ ownerId: OTHER, strength: 50 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atkA, atkB, atkC, defA, defB);
    });

    // First suspend: sit-out, decided by the larger (attacking) side.
    const { state: s1, events: e1 } = applyAction(state, {
      ...attackAction,
      unitIds: [atkA.id, atkB.id, atkC.id],
    });
    const susp1 = s1 as MainGameState;
    expect(susp1.combatPrompt?.kind).toBe("sit_out");
    expect(susp1.combatPrompt?.playerId).toBe(ACTIVE);
    expect(e1.some((e) => e.type === "combat_pair_resolved")).toBe(false); // nothing resolved yet

    // Drop one attacker → 2v2, which must re-suspend for the matchup decision.
    const { state: s2, events: e2 } = applyAction(susp1, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "sit_out", sitOutUnitIds: [atkC.id] },
    });
    const susp2 = s2 as MainGameState;
    expect(susp2.combatPrompt?.kind).toBe("assign_matchups");
    expect(susp2.combatPrompt?.playerId).toBe(OTHER); // the defender pairs
    expect(susp2.combatPrompt?.round).toBe(0); // still the same round
    expect(susp2.combatPrompt?.atkRolls).toHaveLength(2);
    expect(susp2.combatPrompt?.defRolls).toHaveLength(2);
    expect(e2.some((e) => e.type === "combat_pair_resolved")).toBe(false); // still nothing resolved

    // Submit the matchup and let the fight finish.
    const { state: done, events: e3 } = runToEnd(susp2);
    expect(done.combatPrompt).toBeUndefined();
    expect(e3.some((e) => e.type === "combat_pair_resolved")).toBe(true);
    expect(e3.filter((e) => e.type === "combat_resolved")).toHaveLength(1);
  });

  it("enumerates every sit-out combination, greedy-weakest first, decider-only", () => {
    // 3-vs-1 (excess 2): the larger (attacking) side may drop any 2 of 3, so
    // `getValidActions` offers C(3,2) = 3 sit-outs. Strength gaps > 6 make power
    // order track strength order regardless of the d6, so `[0]` (weakest-first)
    // sits out the two weakest, keeping the strongest to fight.
    const atkStrong = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const atkMid = makeUnit({ ownerId: ACTIVE, strength: 50 });
    const atkWeak = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atkStrong, atkMid, atkWeak, defender);
    });
    const { state: next } = applyAction(state, {
      ...attackAction,
      unitIds: [atkStrong.id, atkMid.id, atkWeak.id],
    });
    const susp = next as MainGameState;

    const offered = getValidActions(susp, ACTIVE);
    expect(offered).toHaveLength(3); // C(3, 2)
    for (const act of offered) {
      if (act.type !== "resolve_combat_round") continue;
      if (act.decision.kind !== "sit_out") throw new Error("expected sit_out decisions");
      expect(act.decision.sitOutUnitIds).toHaveLength(2);
      expect(new Set(act.decision.sitOutUnitIds).size).toBe(2); // distinct
    }
    // Greedy default `[0]`: the two weakest sit out (mid + weak), strongest fights.
    const greedy = offered[0];
    if (greedy.type !== "resolve_combat_round" || greedy.decision.kind !== "sit_out") {
      throw new Error("expected a sit_out action at [0]");
    }
    expect(new Set(greedy.decision.sitOutUnitIds)).toEqual(new Set([atkMid.id, atkWeak.id]));

    // Only the decider (the larger side) is offered anything.
    expect(getValidActions(susp, OTHER)).toHaveLength(0);
  });

  it("carries the shown rolls unchanged across both suspends and does not re-roll", () => {
    // The rolls revealed at the sit_out suspend must be the exact rolls used at
    // the later matchup suspend and at resolution — no re-roll, no rng advance
    // across the sit-out step (sit-out consumes no randomness).
    const atkA = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const atkB = makeUnit({ ownerId: ACTIVE, strength: 50 });
    const atkC = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defA = makeUnit({ ownerId: OTHER, strength: 100 });
    const defB = makeUnit({ ownerId: OTHER, strength: 50 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atkA, atkB, atkC, defA, defB);
    });

    const { state: s1 } = applyAction(state, {
      ...attackAction,
      unitIds: [atkA.id, atkB.id, atkC.id],
    });
    const susp1 = s1 as MainGameState;
    const rollAtSuspend1 = new Map<string, number>();
    for (const side of [...susp1.combatPrompt!.atkRolls, ...susp1.combatPrompt!.defRolls]) {
      rollAtSuspend1.set(side.unitId, side.roll);
    }

    const { state: s2 } = applyAction(susp1, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "sit_out", sitOutUnitIds: [atkC.id] },
    });
    const susp2 = s2 as MainGameState;

    // rng must not advance across the sit-out resolution — resolution and sit-out
    // consume no randomness, so the stream resumes unbroken.
    expect(susp2.rngState).toEqual(susp1.rngState);

    // Every surviving participant keeps the roll it was shown at the first suspend.
    for (const side of [...susp2.combatPrompt!.atkRolls, ...susp2.combatPrompt!.defRolls]) {
      expect(rollAtSuspend1.has(side.unitId)).toBe(true);
      expect(side.roll).toBe(rollAtSuspend1.get(side.unitId)!);
    }
  });
});

// ---------------------------------------------------------------------------
// per-round retreat (#168)
// ---------------------------------------------------------------------------

describe("per-round retreat (#168)", () => {
  const attackAction = { type: "attack" as const, playerId: ACTIVE, row: 0, col: 0 };

  /**
   * Reach the round-1 retreat offer. A 2v2 whose round 0 is cross-paired so each
   * side's strong unit kills the other side's weak unit (100 vs 1 → always a
   * kill), leaving one healthy unit per side to face off in round 1 — which is
   * where the pre-roll retreat offer is raised (attacker first). Strength gaps
   * make every outcome roll-independent, so the scenario is deterministic without
   * pinning dice.
   */
  function reachRound1Retreat(): {
    state: MainGameState;
    events: GameEvent[];
    aWin: string;
    aLose: string;
    dWin: string;
  } {
    const aWin = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const aLose = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const dWin = makeUnit({ ownerId: OTHER, strength: 100 });
    const dLose = makeUnit({ ownerId: OTHER, strength: 1 });
    const start = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(aWin, aLose, dWin, dLose);
    });

    // Round 0: 2v2 → defender assigns matchups (no retreat is offered at round 0).
    const { state: afterAttack } = applyAction(start, {
      ...attackAction,
      unitIds: [aWin.id, aLose.id],
    });
    const matchup = afterAttack as MainGameState;
    expect(matchup.combatPrompt?.kind).toBe("assign_matchups");

    const { state: afterRound0, events } = applyAction(matchup, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: aWin.id, defenderUnitId: dLose.id },
          { attackerUnitId: aLose.id, defenderUnitId: dWin.id },
        ],
      },
    });
    return { state: afterRound0 as MainGameState, events, aWin: aWin.id, aLose: aLose.id, dWin: dWin.id };
  }

  it("offers retreat to the attacker before round 1 rolls, not at round 0", () => {
    const { state, events, aWin } = reachRound1Retreat();

    // Round 0 resolved its two pairs; the round-1 fight has NOT been rolled yet.
    expect(events.filter((e) => e.type === "combat_pair_resolved")).toHaveLength(2);
    expect(events.some((e) => e.type === "combat_resolved")).toBe(false);

    // Suspended for the attacker's retreat choice, at round 1, before the roll.
    expect(state.combatPrompt?.kind).toBe("retreat");
    expect(state.combatPrompt?.playerId).toBe(ACTIVE);
    expect(state.combatPrompt?.round).toBe(1);

    // The deciding side (attacker) lists its one surviving unit, blind — the
    // slim retreat shape carries identity + strength + injured, no dice/power.
    expect(state.combatPrompt?.retreatUnits?.map((s) => s.unitId)).toEqual([aWin]);
    expect(state.combatPrompt?.retreatUnits?.[0].strength).toBe(100);
    expect(state.combatPrompt?.retreatUnits?.[0].injured).toBe(false);
    // A retreat prompt is pre-roll, so the rolled lists are empty.
    expect(state.combatPrompt?.atkRolls).toEqual([]);
    expect(state.combatPrompt?.defRolls).toEqual([]);
  });

  it("attacker retreat withdraws the side to HQ and hands the win to the defender", () => {
    const { state: suspended, aWin, aLose, dWin } = reachRound1Retreat();

    const { state: next, events } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: true },
    });
    const ns = next as MainGameState;

    // Combat over, no lingering prompt.
    expect(ns.combatPrompt).toBeUndefined();

    // The retreating attacker is back in its HQ, gone from the cell.
    expect(ns.players[ACTIVE_IDX].hq.some((c) => c.id === aWin)).toBe(true);
    expect(ns.grid[0][0].units.some((u) => u.id === aWin)).toBe(false);

    // aLose was committed but killed in round 0, so it is in `attackerUnitIds`
    // yet no longer at the cell — `retreatUnitsToHQ` skips such ids rather than
    // resurrecting them to HQ (it stays in the discard pile from its round-0 kill).
    expect(ns.players[ACTIVE_IDX].hq.some((c) => c.id === aLose)).toBe(false);
    expect(ns.players[ACTIVE_IDX].discardPile.some((c) => c.id === aLose)).toBe(true);

    // The defender stayed and holds the cell — and wins the combat.
    expect(ns.grid[0][0].units.some((u) => u.id === dWin)).toBe(true);
    const resolved = events.find((e) => e.type === "combat_resolved");
    expect(resolved && resolved.type === "combat_resolved" && resolved.winnerId).toBe(OTHER);

    // The retreat is announced so the result dialog can name who withdrew.
    const retreated = events.find((e) => e.type === "combat_retreated");
    expect(retreated && retreated.type === "combat_retreated" && retreated.playerId).toBe(ACTIVE);

    // The per-round combat retreat is a between-rounds decision, not a Move —
    // it costs no AP (unlike the 1-AP Move-action retreat).
    expect(ns.turn.actionPointsRemaining).toBe(suspended.turn.actionPointsRemaining);

    // The withdrawal is surfaced as a to-HQ unit_moved (toRow/toCol === -1) for
    // the sole surviving attacker (aLose died in round 0).
    const toHq = events.filter(
      (e) => e.type === "unit_moved" && e.toRow === -1 && e.toCol === -1,
    );
    expect(toHq).toHaveLength(1);
    expect(toHq[0].type === "unit_moved" && toHq[0].unitId).toBe(aWin);
  });

  it("attacker declining hands the same choice to the defender (a second suspend)", () => {
    const { state: suspended } = reachRound1Retreat();

    const { state: next } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: false },
    });
    const ns = next as MainGameState;

    // Same round, now the defender's retreat decision.
    expect(ns.combatPrompt?.kind).toBe("retreat");
    expect(ns.combatPrompt?.playerId).toBe(OTHER);
    expect(ns.combatPrompt?.round).toBe(1);
  });

  it("defender retreat (after attacker stays) hands the win to the attacker", () => {
    const { state: suspended, aWin, dWin } = reachRound1Retreat();

    const { state: afterAtk } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: false },
    });
    const { state: next, events } = applyAction(afterAtk as MainGameState, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: { kind: "retreat", retreat: true },
    });
    const ns = next as MainGameState;

    expect(ns.combatPrompt).toBeUndefined();
    expect(ns.players[OTHER_IDX].hq.some((c) => c.id === dWin)).toBe(true);
    expect(ns.grid[0][0].units.some((u) => u.id === dWin)).toBe(false);
    expect(ns.grid[0][0].units.some((u) => u.id === aWin)).toBe(true);
    const resolved = events.find((e) => e.type === "combat_resolved");
    expect(resolved && resolved.type === "combat_resolved" && resolved.winnerId).toBe(ACTIVE);

    // The retreating side (defender) is named in a combat_retreated event.
    const retreated = events.find((e) => e.type === "combat_retreated");
    expect(retreated && retreated.type === "combat_retreated" && retreated.playerId).toBe(OTHER);
  });

  it("both sides declining rolls the round instead of re-offering retreat", () => {
    const { state: suspended } = reachRound1Retreat();

    const { state: afterAtk } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: false },
    });
    const { state: next, events } = applyAction(afterAtk as MainGameState, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: { kind: "retreat", retreat: false },
    });
    const ns = next as MainGameState;

    // The round-1 pair was rolled and resolved (proving no retreat re-offer loop),
    // and combat reached a terminal state.
    expect(events.some((e) => e.type === "combat_pair_resolved")).toBe(true);
    const resolved = events.find((e) => e.type === "combat_resolved");
    expect(resolved).toBeDefined();
    expect(ns.combatPrompt).toBeUndefined();
    // The two str-100 units injure exactly one side in round 1 (no 2x kill); the
    // injured loser stays at the cell (drop-out, not removed), so BOTH sides still
    // hold a unit there and the combat ends with no winner — deterministic
    // regardless of which side rolled higher.
    const winnerId = resolved?.type === "combat_resolved" ? resolved.winnerId : undefined;
    expect(winnerId).toBeNull();
  });

  it("retreats every committed unit still at the cell — injured ones too, with their items", () => {
    // Round 0 cross-pairing: the attacker keeps a healthy unit AND an injured one
    // (str 11 loses to str 17 but never by the 2x kill margin, so it survives
    // injured), while the defender keeps a healthy unit. All roll-independent.
    const aHealthy = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const aInjured = makeUnit({ ownerId: ACTIVE, strength: 11 });
    const dDies = makeUnit({ ownerId: OTHER, strength: 1 });
    const dStrong = makeUnit({ ownerId: OTHER, strength: 17 });
    // Equipped to the healthy survivor: an injured unit drops its items in combat
    // (dropEquippedItems), so only a still-equipped unit carries gear on retreat.
    const sword = makeItem({ ownerId: ACTIVE, equippedTo: aHealthy.id });
    const start = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(aHealthy, aInjured, dStrong, dDies);
      d.grid[0][0].items.push(sword);
    });

    const { state: afterAttack } = applyAction(start, {
      ...attackAction,
      unitIds: [aHealthy.id, aInjured.id],
    });
    const { state: afterRound0 } = applyAction(afterAttack as MainGameState, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: aHealthy.id, defenderUnitId: dDies.id },
          { attackerUnitId: aInjured.id, defenderUnitId: dStrong.id },
        ],
      },
    });
    const suspended = afterRound0 as MainGameState;

    // Round 1 retreat offer: only the healthy attacker fights, but the injured one
    // is still at the cell.
    expect(suspended.combatPrompt?.kind).toBe("retreat");
    expect(suspended.grid[0][0].units.some((u) => u.id === aInjured.id && u.injured)).toBe(true);

    // The blind retreat list enumerates BOTH the healthy fighter and the injured
    // survivor (injured units retreat too), the injured one flagged as such.
    const listed = suspended.combatPrompt?.retreatUnits ?? [];
    expect(listed.map((s) => s.unitId).sort()).toEqual([aHealthy.id, aInjured.id].sort());
    expect(listed.find((s) => s.unitId === aInjured.id)?.injured).toBe(true);
    expect(listed.find((s) => s.unitId === aHealthy.id)?.injured).toBe(false);

    const { state: next } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: true },
    });
    const ns = next as MainGameState;
    const hq = ns.players[ACTIVE_IDX].hq;

    // Both attacker units — healthy and injured — retreated to HQ, with the item.
    expect(hq.some((c) => c.id === aHealthy.id)).toBe(true);
    expect(hq.some((c) => c.id === aInjured.id)).toBe(true);
    expect(hq.some((c) => c.id === sword.id)).toBe(true);
    expect(ns.grid[0][0].units.some((u) => u.ownerId === ACTIVE)).toBe(false);
    expect(ns.grid[0][0].items.some((c) => c.id === sword.id)).toBe(false);
  });

  it("enumerates exactly stay + retreat for the decider, nothing for the opponent", () => {
    const { state } = reachRound1Retreat();

    const offered = getValidActions(state, ACTIVE);
    expect(offered).toHaveLength(2);
    for (const act of offered) {
      expect(act.type).toBe("resolve_combat_round");
      if (act.type !== "resolve_combat_round") continue;
      expect(act.decision.kind).toBe("retreat");
    }
    // Element [0] is the non-disruptive "stay" default a bot submits.
    const first = offered[0];
    const second = offered[1];
    expect(first.type === "resolve_combat_round" && first.decision.kind === "retreat" && first.decision.retreat).toBe(false);
    expect(second.type === "resolve_combat_round" && second.decision.kind === "retreat" && second.decision.retreat).toBe(true);

    // The non-decider (defender) gets nothing while the attacker decides.
    expect(getValidActions(state, OTHER)).toHaveLength(0);
  });

  it("rejects non-resolver actions and a mismatched decision kind", () => {
    const { state } = reachRound1Retreat();

    // No other action may run while combat is suspended.
    expect(() => applyAction(state, { type: "pass", playerId: ACTIVE })).toThrow(
      "suspended combat must be resolved first",
    );

    // A retreat prompt must not accept a different decision kind.
    expect(() =>
      applyAction(state, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "sit_out", sitOutUnitIds: [] },
      }),
    ).toThrow('expected a "retreat" decision');
  });

  it("rejects a resolve from someone other than the prompt's decider", () => {
    // Advance to the DEFENDER's retreat prompt (decider = the non-active p1). The
    // active player p2 is admitted past the turn gate but is not the decider, so
    // the retreat handler's decider check rejects it.
    const { state: suspended } = reachRound1Retreat();
    const { state: afterAtk } = applyAction(suspended, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: false },
    });
    const defenderPrompt = afterAtk as MainGameState;
    expect(defenderPrompt.combatPrompt?.playerId).toBe(OTHER);

    expect(() =>
      applyAction(defenderPrompt, {
        type: "resolve_combat_round",
        playerId: ACTIVE,
        decision: { kind: "retreat", retreat: true },
      }),
    ).toThrow('pending combat decision is for "p1", not "p2"');
  });

  it("never offers retreat in a single-round combat that ends at round 0", () => {
    // A 1-vs-1 wipeout resolves entirely within round 0 — no next round begins, so
    // no retreat is ever offered.
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, { ...attackAction, unitIds: [attacker.id] });
    const ns = next as MainGameState;

    expect(ns.combatPrompt).toBeUndefined();
    expect(events.some((e) => e.type === "combat_resolved")).toBe(true);
  });

  it("re-offers retreat afresh at round 2 once both sides declined at round 1", () => {
    // Reaching a round-2 retreat offer needs a healthy fighter on BOTH sides at
    // the top of round 2 — so the settled-round marker must reset per round rather
    // than suppressing all future offers. A 4v4 of two str-100/str-60 "keepers"
    // per side plus two str-1 throwaways: round 0 kills every throwaway (keepers
    // win their pairs and stay healthy), round 1 cross-pairs a str-100 keeper vs
    // the enemy str-60 keeper (100 beats 60 without the 2x kill margin → injures),
    // leaving one healthy keeper per side to face off at round 2. All outcomes are
    // roll-independent (gaps > 6, kill margins strictly < or > 2x).
    const aHi = makeUnit({ ownerId: ACTIVE, strength: 100 });
    const aLo = makeUnit({ ownerId: ACTIVE, strength: 60 });
    const aX1 = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const aX2 = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const dHi = makeUnit({ ownerId: OTHER, strength: 100 });
    const dLo = makeUnit({ ownerId: OTHER, strength: 60 });
    const dX1 = makeUnit({ ownerId: OTHER, strength: 1 });
    const dX2 = makeUnit({ ownerId: OTHER, strength: 1 });
    const start = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(aHi, aLo, aX1, aX2, dHi, dLo, dX1, dX2);
    });

    // Round 0: 4v4 → defender assigns matchups. Each keeper beats an enemy
    // throwaway (killed); each throwaway is killed by an enemy keeper.
    const { state: afterAttack } = applyAction(start, {
      ...attackAction,
      unitIds: [aHi.id, aLo.id, aX1.id, aX2.id],
    });
    const { state: afterRound0 } = applyAction(afterAttack as MainGameState, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: aHi.id, defenderUnitId: dX1.id },
          { attackerUnitId: aLo.id, defenderUnitId: dX2.id },
          { attackerUnitId: aX1.id, defenderUnitId: dHi.id },
          { attackerUnitId: aX2.id, defenderUnitId: dLo.id },
        ],
      },
    });

    // Round 1 retreat offer (attacker) — both sides now have two healthy keepers.
    const round1Atk = afterRound0 as MainGameState;
    expect(round1Atk.combatPrompt?.kind).toBe("retreat");
    expect(round1Atk.combatPrompt?.round).toBe(1);

    // Both decline → round 1 rolls → 2v2 → matchup suspend at round 1.
    const { state: r1AtkDeclined } = applyAction(round1Atk, {
      type: "resolve_combat_round",
      playerId: ACTIVE,
      decision: { kind: "retreat", retreat: false },
    });
    const { state: r1BothDeclined } = applyAction(r1AtkDeclined as MainGameState, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: { kind: "retreat", retreat: false },
    });
    const round1Matchup = r1BothDeclined as MainGameState;
    expect(round1Matchup.combatPrompt?.kind).toBe("assign_matchups");
    expect(round1Matchup.combatPrompt?.round).toBe(1);

    // Cross-pair keepers so each side keeps exactly one healthy survivor.
    const { state: afterRound1 } = applyAction(round1Matchup, {
      type: "resolve_combat_round",
      playerId: OTHER,
      decision: {
        kind: "assign_matchups",
        pairs: [
          { attackerUnitId: aHi.id, defenderUnitId: dLo.id },
          { attackerUnitId: aLo.id, defenderUnitId: dHi.id },
        ],
      },
    });
    const round2Atk = afterRound1 as MainGameState;

    // Round 2 raises a FRESH retreat offer (the round-1 settle did not leak).
    expect(round2Atk.combatPrompt?.kind).toBe("retreat");
    expect(round2Atk.combatPrompt?.round).toBe(2);
    expect(round2Atk.combatPrompt?.playerId).toBe(ACTIVE);
    // The list carries the healthy survivor AND the injured keeper (injured units
    // retreat too), the injured one flagged.
    const listed = round2Atk.combatPrompt?.retreatUnits ?? [];
    expect(listed.map((s) => s.unitId).sort()).toEqual([aHi.id, aLo.id].sort());
    expect(listed.find((s) => s.unitId === aHi.id)?.injured).toBe(false);
    expect(listed.find((s) => s.unitId === aLo.id)?.injured).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// turn lifecycle
// ---------------------------------------------------------------------------

describe("turn lifecycle", () => {
  it("grants gold income at start of next player's turn", () => {
    const state = createTestGame();
    const initialGold = state.players[OTHER_IDX].gold;

    // p2 passes → p1's turn starts (gets income)
    const { state: s1 } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const ns = s1 as MainGameState;
    expect(ns.turn.activePlayerId).toBe(OTHER);
    expect(ns.players[OTHER_IDX].gold).toBe(initialGold + 1);
  });

  it("resets AP at start of turn", () => {
    const card = makeUnit({ ownerId: ACTIVE, cost: "0" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(card);
    });

    // p2 deploys (2 AP left), then passes → p1's turn
    const { state: s1 } = applyAction(state, {
      type: "deploy",
      playerId: ACTIVE,
      cardId: card.id,
    });
    // p1 passes → p2's turn starts with full AP
    const { state: s2 } = applyAction(s1, {
      type: "pass",
      playerId: (s1 as MainGameState).turn.activePlayerId,
    });
    expect((s2 as MainGameState).turn.actionPointsRemaining).toBe(3);
  });

  it("heals injured units in HQ at start of turn", () => {
    const unit = makeUnit({ ownerId: ACTIVE, injured: true });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(unit);
    });

    // p2 passes → p1 passes → p2's turn starts (heals HQ units)
    const { state: s1 } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const { state: s2 } = applyAction(s1, {
      type: "pass",
      playerId: (s1 as MainGameState).turn.activePlayerId,
    });
    const ns = s2 as MainGameState;
    const healedUnit = ns.players[ACTIVE_IDX].hq.find((c) => c.id === unit.id) as UnitCard;
    expect(healedUnit).toBeDefined();
    expect(healedUnit.injured).toBe(false);
  });

  it("enforces hand size limit at end of turn", () => {
    const state = gameWith((d) => {
      for (let i = 0; i < 10; i++) {
        d.players[ACTIVE_IDX].hand.push(makeUnit({ ownerId: ACTIVE }));
      }
    });

    const { state: next } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const ns = next as MainGameState;
    expect(ns.players[ACTIVE_IDX].hand.length).toBeLessThanOrEqual(7);
  });

  it("emits card_discarded events when hand exceeds limit", () => {
    const state = gameWith((d) => {
      for (let i = 0; i < 10; i++) {
        d.players[ACTIVE_IDX].hand.push(makeUnit({ ownerId: ACTIVE }));
      }
    });

    const { events } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const discardEvents = events.filter(
      (e) => e.type === "card_discarded" && "reason" in e && e.reason === "hand_limit",
    );
    expect(discardEvents.length).toBe(3); // 10 → 7 = 3 discarded
  });

  it("does not auto-advance when AP exhausted (player can still buy)", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "0" });
    const state = gameWith((d) => {
      d.turn.actionPointsRemaining = 0;
      d.market.push(marketCard);
    });

    // At 0 AP, player can still buy (0 AP cost)
    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;

    // Still the same player's turn
    expect(ns.turn.activePlayerId).toBe(ACTIVE);
    expect(ns.turn.actionPointsRemaining).toBe(0);
  });

  it("decrements passive event duration and expires them", () => {
    const passiveEvent = { ...makePassiveEvent({ ownerId: ACTIVE, cost: "0", duration: 1 }), remainingDuration: 1 };
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].passiveEvents.push(passiveEvent);
    });

    const { state: next, events } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.passiveEvents).toHaveLength(0);
    expect(p.discardPile.some((c) => c.id === passiveEvent.id)).toBe(true);
    expect(events.some((e) => e.type === "passive_expired")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AP validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// traps
// ---------------------------------------------------------------------------

describe("traps", () => {
  it("auto-triggers sprung-trap trap when enemy unit enters location", () => {
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "sprung-trap", trigger: "enemy_unit_enters_location" });
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: OTHER });
    const state = gameWith((d) => {
      // OTHER (p1) has a trap targeting the location
      d.players[OTHER_IDX].activeTraps.push({ card: trap, targetId: location.id });
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = location;
    });

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
    // Trap is discarded
    expect(ns.players[OTHER_IDX].activeTraps).toHaveLength(0);
    expect(ns.players[OTHER_IDX].discardPile.some((c) => c.id === trap.id)).toBe(true);
    // Unit is injured
    const injuredUnit = ns.grid[0][0].units.find((u) => u.id === unit.id);
    expect(injuredUnit?.injured).toBe(true);
  });

  it("assassination-attempt kills weak unit", () => {
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "assassination-attempt", trigger: "enemy_unit_enters_location" });
    const weakUnit = makeUnit({ ownerId: ACTIVE, strength: 4 });
    const location = makeLocation({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.players[OTHER_IDX].activeTraps.push({ card: trap, targetId: location.id });
      d.players[ACTIVE_IDX].hq.push(weakUnit);
      d.grid[0][0].location = location;
    });

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: ACTIVE,
      unitId: weakUnit.id,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(ns.grid[0][0].units.every((u) => u.id !== weakUnit.id)).toBe(true);
    expect(ns.players[ACTIVE_IDX].discardPile.some((c) => c.id === weakUnit.id)).toBe(true);
  });

  it("does not trigger trap at wrong location", () => {
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "sprung-trap", trigger: "enemy_unit_enters_location" });
    const loc1 = makeLocation({ ownerId: OTHER });
    const loc2 = makeLocation({ ownerId: OTHER });
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      // Trap targets loc1 but unit enters loc2
      d.players[OTHER_IDX].activeTraps.push({ card: trap, targetId: loc1.id });
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = loc1;
      d.grid[0][1].location = loc2;
    });

    const { events } = applyAction(state, {
      type: "enter",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 1,
    });

    expect(events.some((e) => e.type === "trap_triggered")).toBe(false);
  });

  it("does not trigger own traps", () => {
    const trap = makeTrapEvent({ ownerId: ACTIVE, definitionId: "sprung-trap", trigger: "enemy_unit_enters_location" });
    const location = makeLocation({ ownerId: ACTIVE });
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].activeTraps.push({ card: trap, targetId: location.id });
      d.players[ACTIVE_IDX].hq.push(unit);
      d.grid[0][0].location = location;
    });

    const { events } = applyAction(state, {
      type: "enter",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    expect(events.some((e) => e.type === "trap_triggered")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attempt_mission
// ---------------------------------------------------------------------------

describe("attempt_mission", () => {
  it("awards VP and replaces location on completion", () => {
    const unit1 = makeUnit({ ownerId: ACTIVE, attributes: ["Knowledge"] });
    const unit2 = makeUnit({ ownerId: ACTIVE, attributes: ["Knowledge"] });
    const location = makeLocation({ ownerId: OTHER, requirements: "knowledge_2", rewards: "5vp" });
    const replacement = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(unit1, unit2);
      d.players[ACTIVE_IDX].prospectDeck.push(replacement);
    });

    const { state: next, events } = applyAction(state, {
      type: "attempt_mission",
      playerId: ACTIVE,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    // VP awarded
    expect(p.vp).toBe(5);
    // Units and location discarded to completing player
    expect(p.discardPile.some((c) => c.id === unit1.id)).toBe(true);
    expect(p.discardPile.some((c) => c.id === unit2.id)).toBe(true);
    expect(p.removedFromGame.some((c) => c.id === location.id)).toBe(true);
    // Replacement location placed
    expect(ns.grid[0][0].location?.id).toBe(replacement.id);
    expect(ns.grid[0][0].units).toHaveLength(0);
    // Events
    expect(events.some((e) => e.type === "mission_completed")).toBe(true);
    expect(events.some((e) => e.type === "location_placed")).toBe(true);
  });

  it("fails gracefully when requirements not met", () => {
    const unit = makeUnit({ ownerId: ACTIVE, attributes: ["Military"] });
    const location = makeLocation({ ownerId: OTHER, requirements: "knowledge_2", rewards: "5vp" });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(unit);
    });

    const { state: next, events } = applyAction(state, {
      type: "attempt_mission",
      playerId: ACTIVE,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    // No VP, emits mission_attempt_failed
    expect(ns.players[ACTIVE_IDX].vp).toBe(0);
    expect(events.some((e) => e.type === "mission_completed")).toBe(false);
    expect(events.some((e) => e.type === "mission_attempt_failed")).toBe(true);
    // Units and location stay
    expect(ns.grid[0][0].units).toHaveLength(1);
    expect(ns.grid[0][0].location?.id).toBe(location.id);
    // AP still spent
    expect(ns.turn.actionPointsRemaining).toBe(2);
  });

  it("rejects when no friendly units at location", () => {
    const location = makeLocation({ ownerId: OTHER, requirements: "knowledge_2", rewards: "5vp" });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
    });

    expect(() =>
      applyAction(state, { type: "attempt_mission", playerId: ACTIVE, row: 0, col: 0 }),
    ).toThrow("No friendly units");
  });

  it("rejects when location has no mission", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: OTHER }); // no mission field
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(unit);
    });

    expect(() =>
      applyAction(state, { type: "attempt_mission", playerId: ACTIVE, row: 0, col: 0 }),
    ).toThrow("no mission");
  });
});

// ---------------------------------------------------------------------------
// combat: injury, item drops, multi-unit
// ---------------------------------------------------------------------------

describe("combat details", () => {
  it("injures a defender when power difference is less than 2x", () => {
    // Attacker strength 7, defender strength 5
    // Power range: attacker 8-13, defender 6-11
    // Best case ratio: 13/6 = 2.16 (kill), worst: 8/11 (attacker loses)
    // With seeded RNG this is deterministic — verify the outcome
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 7 });
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });

    // With seeded RNG, at least one of injury or kill should happen
    const hasInjury = events.some((e) => e.type === "unit_injured");
    const hasKill = events.some((e) => e.type === "unit_killed");
    expect(hasInjury || hasKill).toBe(true);
  });

  it("kills an already-injured unit on any combat loss", () => {
    // Defender is already injured — any loss kills them
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 5, injured: true });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
  });

  it("drops equipped items when a unit is killed", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const sword = makeItem({ ownerId: OTHER, equippedTo: defender.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
      d.grid[0][0].items.push(sword);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "item_dropped")).toBe(true);
    // Item is unequipped and remains at location
    const item = ns.grid[0][0].items.find((i) => i.id === sword.id);
    expect(item).toBeDefined();
    expect(item!.equippedTo).toBeUndefined();
  });

  it("handles multi-unit combat with 2 attackers vs 1 defender", () => {
    const atk1 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const atk2 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(atk1, atk2, defender);
    });

    // 2-vs-1: the attacker is the larger side, so combat suspends for a sit-out
    // choice (#167) before resolving. Drive the greedy default (`[0]`) to sit one
    // attacker out, leaving a 1-vs-1 that resolves.
    const { state: suspended, events: startEvents } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [atk1.id, atk2.id],
      row: 0,
      col: 0,
    });
    let cur = suspended as MainGameState;
    expect(cur.combatPrompt?.kind).toBe("sit_out");
    expect(cur.combatPrompt?.playerId).toBe(ACTIVE); // the larger (attacking) side decides

    const events: GameEvent[] = [...startEvents];
    let guard = 0;
    while (cur.combatPrompt) {
      if (guard++ > 10) throw new Error("combat failed to terminate");
      const r = applyAction(cur, getValidActions(cur, cur.combatPrompt.playerId)[0] as MainAction);
      cur = r.state as MainGameState;
      events.push(...r.events);
    }
    const ns = cur;

    expect(events.some((e) => e.type === "combat_resolved")).toBe(true);
    // Defender should be dead (a strong attacker vs 1 weak defender)
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
    // Both attackers should survive — the one that fought and the one that sat out
    expect(ns.grid[0][0].units.some((u) => u.id === atk1.id)).toBe(true);
    expect(ns.grid[0][0].units.some((u) => u.id === atk2.id)).toBe(true);
  });

  // #151: combat ties go to the defender. A tie is equality of *final attack
  // power* — base stat + every modifier + the d6 roll — not equal base stats.
  // Under SEED="test-seed" round 1 rolls attacker 1 / defender 2, so a +1
  // strength modifier on the attacker levels the sums: 5 + 1 + 1 == 5 + 2. The
  // modifier stands in for any modifier source (location passive, item, injury
  // penalty, a future StatModifierListener) — all fold into one sum. Combat is
  // multi-round, so we assert the tied *pair* resolves against the attacker,
  // not the terminal state — under drop-out survivor semantics the injured
  // attacker leaves the pool after this round rather than fighting on.
  it("resolves a tied combat pair against the attacker (injure_attacker)", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5 });
    attacker.statModifiers = [
      {
        stat: "strength",
        delta: 1,
        remainingDuration: 99,
        source: { type: "unit", cardId: attacker.id, definitionId: "test-buff" },
      },
    ];
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });

    const pairs = events.filter(
      (e): e is Extract<GameEvent, { type: "combat_pair_resolved" }> =>
        e.type === "combat_pair_resolved",
    );
    // The engineered tie is round 1, so assert pairs[0] rather than find() — a
    // later coincidental tie must not be what satisfies the test.
    const tiePair = pairs[0];
    expect(tiePair).toBeDefined();
    // Premise guard: round 1 rolled the documented values and the sums tied.
    expect(tiePair.attacker.roll).toBe(1);
    expect(tiePair.defender.roll).toBe(2);
    expect(tiePair.attacker.power).toBe(tiePair.defender.power);
    expect(tiePair.outcome).toBe("injure_attacker");
    // The old no-consequence tie short-circuit is gone — combat never emits "tie".
    expect(pairs.every((e) => e.outcome !== "tie")).toBe(true);
  });

  it("kills the attacker on a tie when it is already injured, dropping its items", () => {
    // Injured attacker carries a -1 injury penalty in the sum, so a +2 modifier
    // is needed to tie: max(0, 5 + 2 - 1) + 1(roll) == 5 + 2(roll) == 7.
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5, injured: true });
    attacker.statModifiers = [
      {
        stat: "strength",
        delta: 2,
        remainingDuration: 99,
        source: { type: "unit", cardId: attacker.id, definitionId: "test-buff" },
      },
    ];
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const sword = makeItem({ ownerId: ACTIVE, equippedTo: attacker.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
      d.grid[0][0].items.push(sword);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    const pair = events.find((e) => e.type === "combat_pair_resolved");
    if (pair?.type !== "combat_pair_resolved") throw new Error("expected combat_pair_resolved");
    expect(pair.attacker.roll).toBe(1);
    expect(pair.defender.roll).toBe(2);
    expect(pair.attacker.power).toBe(pair.defender.power);
    // Tie → attacker loses; already-injured loser is killed, not injured again.
    expect(pair.outcome).toBe("kill_attacker");
    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(events.some((e) => e.type === "item_dropped")).toBe(true);
    // Attacker removed from the grid; its item stays behind, unequipped.
    expect(ns.grid[0][0].units.every((u) => u.id !== attacker.id)).toBe(true);
    expect(ns.grid[0][0].items.find((i) => i.id === sword.id)?.equippedTo).toBeUndefined();
  });

  // #151 regression: removing the tie short-circuit must not disturb a clean
  // defender loss. The attacker out-powers the defender enough to guarantee a
  // kill regardless of the d6 rolls (20+roll vs 1+roll, kill ratio 2).
  it("resolves a decisive attacker win end-to-end (winnerId is the attacker)", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    const pair = events.find((e) => e.type === "combat_pair_resolved");
    if (pair?.type !== "combat_pair_resolved") throw new Error("expected combat_pair_resolved");
    expect(pair.attacker.power).toBeGreaterThan(pair.defender.power);
    expect(pair.outcome).toBe("kill_defender");

    const resolved = events.find((e) => e.type === "combat_resolved");
    if (resolved?.type !== "combat_resolved") throw new Error("expected combat_resolved");
    expect(resolved.winnerId).toBe(ACTIVE);
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// move: ownership and trap on move
// ---------------------------------------------------------------------------

describe("move details", () => {
  it("rejects moving an opponent's unit", () => {
    const enemyUnit = makeUnit({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(enemyUnit);
    });

    expect(() =>
      applyAction(state, {
        type: "move",
        playerId: ACTIVE,
        unitId: enemyUnit.id,
        row: 0,
        col: 1,
      }),
    ).toThrow("not owned");
  });

  it("triggers traps when moving to a new cell", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const trap = makeTrapEvent({
      ownerId: OTHER,
      definitionId: "sprung-trap",
      trigger: "enemy_unit_enters_location",
    });
    const loc1 = makeLocation({ ownerId: ACTIVE });
    const loc2 = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = loc1;
      d.grid[0][1].location = loc2;
      d.grid[0][0].units.push(unit);
      d.players[OTHER_IDX].activeTraps.push({ card: trap, targetId: loc2.id });
    });

    const { events } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: 0,
      col: 1,
    });

    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// equip: grid items
// ---------------------------------------------------------------------------

describe("equip details", () => {
  it("equips a grid item to a co-located unit on the grid", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const item = makeItem({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(item);
    });

    const { state: next, events } = applyAction(state, {
      type: "equip",
      playerId: ACTIVE,
      itemId: item.id,
      unitId: unit.id,
    });
    const ns = next as MainGameState;

    const equipped = ns.grid[0][0].items.find((i) => i.id === item.id);
    expect(equipped).toBeDefined();
    expect(equipped!.equippedTo).toBe(unit.id);
    expect(events.some((e) => e.type === "item_equipped")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AP validation
// ---------------------------------------------------------------------------

describe("AP validation", () => {
  it("rejects actions when AP is insufficient", () => {
    const state = gameWith((d) => {
      d.turn.actionPointsRemaining = 0;
    });

    expect(() =>
      applyAction(state, { type: "draw", playerId: ACTIVE }),
    ).toThrow("Not enough AP");
  });
});
