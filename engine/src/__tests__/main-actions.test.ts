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

  it("allows retreat to HQ from perimeter with open boundary edge", () => {
    const unit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
    });

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: ACTIVE,
      unitId: unit.id,
      row: -1,
      col: -1,
    });
    const ns = next as MainGameState;

    expect(ns.grid[0][0].units).toHaveLength(0);
    expect(ns.players[ACTIVE_IDX].hq.some((c) => c.id === unit.id)).toBe(true);
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
      expect(act.decision.pairs).toHaveLength(3);
      expect(new Set(act.decision.pairs.map((p) => p.defenderUnitId)).size).toBe(3);
    }
  });

  it("auto-resolves atomically for a trivial pairing (one side has a single unit)", () => {
    // 1-vs-3: min(1,3) = 1, so there is only one possible matching — no defender
    // decision. Combat resolves in a single action with no lingering prompt.
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

    const { state: next, events } = applyAction(state, {
      ...attackAction,
      unitIds: [attacker.id],
    });
    const ns = next as MainGameState;

    expect(ns.combatPrompt).toBeUndefined();
    expect(events.some((e) => e.type === "combat_resolved")).toBe(true);
  });

  it("throws if multiple prompts are set at once (mutual-exclusion invariant)", () => {
    // combatPrompt / pickPrompt / viewPrompt are mutually exclusive; a producer
    // that co-sets two must fail loud at dispatch rather than deadlock.
    const state = gameWith((d) => {
      d.combatPrompt = {
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
  it("auto-triggers ambush trap when enemy unit enters location", () => {
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "ambush", trigger: "enemy_unit_enters_location" });
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
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "ambush", trigger: "enemy_unit_enters_location" });
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
    const trap = makeTrapEvent({ ownerId: ACTIVE, definitionId: "ambush", trigger: "enemy_unit_enters_location" });
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

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [atk1.id, atk2.id],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "combat_resolved")).toBe(true);
    // Defender should be dead (2 strong attackers vs 1 weak defender)
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
    // Attackers should survive
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
      definitionId: "ambush",
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
