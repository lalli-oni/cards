import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import type { MainGameState, UnitCard } from "../types";
import { getValidActions } from "../valid-actions";
import {
  createTestGame,
  makeInstantEvent,
  makeItem,
  makeLocation,
  makePassiveEvent,
  makeTrapEvent,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

// With SEED="test-seed", turnOrder is ["p2","p1"] — p2 goes first (players[1]).
const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 1;

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
    expect(events.some((e) => e.type === "card_bought")).toBe(true);
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

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const p = ns.players[ACTIVE_IDX];

    expect(p.hand.some((c) => c.id === marketCard.id)).toBe(true);
    expect(p.hand.some((c) => c.id === eventCard.id)).toBe(true);
    expect(ns.market[0].id).toBe(nonEventCard.id);
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
    expect(events.some((e) => e.type === "card_drawn")).toBe(true);
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
    // Raze costs 3 AP (all), triggering auto-advance
    expect(events.some((e) => e.type === "turn_ended")).toBe(true);
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
    const p1 = ns.players[0]; // OTHER = p1 = players[0]

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(p1.discardPile.some((c) => c.id === defender.id)).toBe(true);
    expect(ns.grid[0][0].units.every((u) => u.id !== defender.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// turn lifecycle
// ---------------------------------------------------------------------------

describe("turn lifecycle", () => {
  it("grants gold income at start of next player's turn", () => {
    const state = createTestGame();
    const initialGold = state.players[0].gold; // p1's gold

    // p2 passes → p1's turn starts (gets income)
    const { state: s1 } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const ns = s1 as MainGameState;
    expect(ns.turn.activePlayerId).toBe(OTHER);
    expect(ns.players[0].gold).toBe(initialGold + 1);
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

  it("auto-advances turn when AP exhausted", () => {
    const state = createTestGame();

    // 3 draws exhaust AP → auto-advance to p1
    let s = state as MainGameState;
    for (let i = 0; i < 3; i++) {
      const { state: next } = applyAction(s, { type: "draw", playerId: ACTIVE });
      s = next as MainGameState;
    }

    expect(s.turn.activePlayerId).toBe(OTHER);
    expect(s.turn.actionPointsRemaining).toBe(3);
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
      d.players[0].activeTraps.push({ card: trap, targetId: location.id });
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
    expect(ns.players[0].activeTraps).toHaveLength(0);
    expect(ns.players[0].discardPile.some((c) => c.id === trap.id)).toBe(true);
    // Unit is injured
    const injuredUnit = ns.grid[0][0].units.find((u) => u.id === unit.id);
    expect(injuredUnit?.injured).toBe(true);
  });

  it("assassination-attempt kills weak unit", () => {
    const trap = makeTrapEvent({ ownerId: OTHER, definitionId: "assassination-attempt", trigger: "enemy_unit_enters_location" });
    const weakUnit = makeUnit({ ownerId: ACTIVE, strength: 4 });
    const location = makeLocation({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.players[0].activeTraps.push({ card: trap, targetId: location.id });
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
      d.players[0].activeTraps.push({ card: trap, targetId: loc1.id });
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
    const unit1 = makeUnit({ ownerId: ACTIVE, attributes: ["Scientist"] });
    const unit2 = makeUnit({ ownerId: ACTIVE, attributes: ["Scientist"] });
    const location = makeLocation({ ownerId: OTHER, mission: "scientist_2>5" });
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
    expect(p.discardPile.some((c) => c.id === location.id)).toBe(true);
    // Replacement location placed
    expect(ns.grid[0][0].location?.id).toBe(replacement.id);
    expect(ns.grid[0][0].units).toHaveLength(0);
    // Events
    expect(events.some((e) => e.type === "mission_completed")).toBe(true);
    expect(events.some((e) => e.type === "location_placed")).toBe(true);
  });

  it("fails gracefully when requirements not met", () => {
    const unit = makeUnit({ ownerId: ACTIVE, attributes: ["Warrior"] });
    const location = makeLocation({ ownerId: OTHER, mission: "scientist_2>5" });
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
    const location = makeLocation({ ownerId: OTHER, mission: "scientist_2>5" });
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
      d.players[0].activeTraps.push({ card: trap, targetId: loc2.id }); // p1 (OTHER) traps loc2
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
