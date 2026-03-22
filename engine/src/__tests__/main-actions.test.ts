import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import type { MainGameState, UnitCard } from "../types";
import {
  createTestGame,
  makeEvent,
  makeItem,
  makeLocation,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

/**
 * Create a test game and apply mutations to the active player's state.
 * The callback receives the draft, the active player's index, and their ID.
 */
function gameWith(
  fn: (draft: MainGameState, activeIdx: number, activePlayerId: string) => void,
): MainGameState {
  const base = createTestGame();
  return produce(base, (draft) => {
    const idx = draft.players.findIndex(
      (p) => p.id === draft.turn.activePlayerId,
    );
    fn(draft, idx, draft.turn.activePlayerId);
  });
}

/** Get the non-active player ID. */
function otherPlayerId(state: MainGameState): string {
  return state.turnOrder.find((id) => id !== state.turn.activePlayerId)!;
}

// ---------------------------------------------------------------------------
// deploy
// ---------------------------------------------------------------------------

describe("deploy", () => {
  it("moves a unit from hand to HQ and deducts gold", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid, cost: "3" });
      unitId = unit.id;
      d.players[ai].hand.push(unit);
      d.players[ai].gold = 10;
    });

    const { state: next, events } = applyAction(state, {
      type: "deploy",
      playerId: state.turn.activePlayerId,
      cardId: unitId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(0);
    expect(p.hq).toHaveLength(1);
    expect(p.hq[0].id).toBe(unitId!);
    expect(p.gold).toBe(7);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "card_deployed")).toBe(true);
  });

  it("moves an item from hand to HQ", () => {
    let itemId: string;
    const state = gameWith((d, ai, pid) => {
      const item = makeItem({ ownerId: pid, cost: "0" });
      itemId = item.id;
      d.players[ai].hand.push(item);
    });

    const { state: next } = applyAction(state, {
      type: "deploy",
      playerId: state.turn.activePlayerId,
      cardId: itemId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    expect(p.hq).toHaveLength(1);
    expect(p.hq[0].type).toBe("item");
  });

  it("rejects deploying a non-unit/item card", () => {
    let eventId: string;
    const state = gameWith((d, ai, pid) => {
      const event = makeEvent({ ownerId: pid, subtype: "instant" });
      eventId = event.id;
      d.players[ai].hand.push(event);
    });

    expect(() =>
      applyAction(state, {
        type: "deploy",
        playerId: state.turn.activePlayerId,
        cardId: eventId!,
      }),
    ).toThrow("only units and items");
  });

  it("rejects deploying when gold is insufficient", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid, cost: "99" });
      unitId = unit.id;
      d.players[ai].hand.push(unit);
      d.players[ai].gold = 5;
    });

    expect(() =>
      applyAction(state, {
        type: "deploy",
        playerId: state.turn.activePlayerId,
        cardId: unitId!,
      }),
    ).toThrow("cannot afford");
  });

  it("rejects deploying a card not in hand", () => {
    const state = createTestGame();
    expect(() =>
      applyAction(state, {
        type: "deploy",
        playerId: state.turn.activePlayerId,
        cardId: "nonexistent",
      }),
    ).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// buy
// ---------------------------------------------------------------------------

describe("buy", () => {
  it("purchases a card from market and adds to hand", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "4" });
    const state = gameWith((d, ai) => {
      d.market.push(marketCard);
      d.players[ai].gold = 10;
    });

    const { state: next, events } = applyAction(state, {
      type: "buy",
      playerId: state.turn.activePlayerId,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand.some((c) => c.id === marketCard.id)).toBe(true);
    expect(p.gold).toBe(6);
    expect(ns.turn.actionPointsRemaining).toBe(3); // 0 AP
    expect(events.some((e) => e.type === "card_bought")).toBe(true);
  });

  it("replenishes market slot from active player's market deck", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "1" });
    const replacementCard = makeItem({ ownerId: "neutral", cost: "2" });
    const state = gameWith((d, ai) => {
      d.market.push(marketCard);
      d.players[ai].marketDeck.push(replacementCard);
    });

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: state.turn.activePlayerId,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    expect(ns.market).toHaveLength(1);
    expect(ns.market[0].id).toBe(replacementCard.id);
  });

  it("applies event draw mechanic — events go to hand", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "0" });
    const eventCard = makeEvent({ ownerId: "neutral", subtype: "instant" });
    const nonEventCard = makeItem({ ownerId: "neutral", cost: "1" });
    const state = gameWith((d, ai) => {
      d.market.push(marketCard);
      d.players[ai].marketDeck.push(eventCard, nonEventCard);
    });

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: state.turn.activePlayerId,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand.some((c) => c.id === marketCard.id)).toBe(true);
    expect(p.hand.some((c) => c.id === eventCard.id)).toBe(true);
    expect(ns.market[0].id).toBe(nonEventCard.id);
  });

  it("supports alternative costs via costIndex", () => {
    const card = makeUnit({ ownerId: "neutral", cost: "10|2" });
    const state = gameWith((d, ai) => {
      d.market.push(card);
      d.players[ai].gold = 5;
    });

    expect(() =>
      applyAction(state, {
        type: "buy",
        playerId: state.turn.activePlayerId,
        cardId: card.id,
        costIndex: 0,
      }),
    ).toThrow("cannot afford");

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: state.turn.activePlayerId,
      cardId: card.id,
      costIndex: 1,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    expect(p.gold).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// draw
// ---------------------------------------------------------------------------

describe("draw", () => {
  it("draws a card from main deck to hand", () => {
    let cardId: string;
    const state = gameWith((d, ai, pid) => {
      const card = makeUnit({ ownerId: pid });
      cardId = card.id;
      d.players[ai].mainDeck.push(card);
    });

    const { state: next, events } = applyAction(state, {
      type: "draw",
      playerId: state.turn.activePlayerId,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(1);
    expect(p.hand[0].id).toBe(cardId!);
    expect(p.mainDeck).toHaveLength(0);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "card_drawn")).toBe(true);
  });

  it("shuffles discard into main deck when empty", () => {
    const state = gameWith((d, ai, pid) => {
      d.players[ai].discardPile.push(makeUnit({ ownerId: pid }));
    });

    const { state: next, events } = applyAction(state, {
      type: "draw",
      playerId: state.turn.activePlayerId,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(1);
    expect(p.discardPile).toHaveLength(0);
    expect(events.some((e) => e.type === "deck_shuffled")).toBe(true);
  });

  it("draws nothing when both deck and discard are empty", () => {
    const state = createTestGame();
    const { state: next } = applyAction(state, {
      type: "draw",
      playerId: state.turn.activePlayerId,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    expect(p.hand).toHaveLength(0);
    expect(ns.turn.actionPointsRemaining).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe("destroy", () => {
  it("removes a card from hand permanently", () => {
    let cardId: string;
    const state = gameWith((d, ai, pid) => {
      const card = makeUnit({ ownerId: pid });
      cardId = card.id;
      d.players[ai].hand.push(card);
    });

    const { state: next, events } = applyAction(state, {
      type: "destroy",
      playerId: state.turn.activePlayerId,
      cardId: cardId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(0);
    expect(p.removedFromGame).toHaveLength(1);
    expect(p.removedFromGame[0].id).toBe(cardId!);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "card_destroyed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enter
// ---------------------------------------------------------------------------

describe("enter", () => {
  it("moves a unit from HQ to a perimeter grid cell", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.players[ai].hq.push(unit);
      d.grid[0][0].location = makeLocation({ ownerId: pid });
    });

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: state.turn.activePlayerId,
      unitId: unitId!,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hq).toHaveLength(0);
    expect(ns.grid[0][0].units).toHaveLength(1);
    expect(ns.grid[0][0].units[0].id).toBe(unitId!);
    expect(ns.turn.actionPointsRemaining).toBe(2);
    expect(events.some((e) => e.type === "unit_entered")).toBe(true);
  });

  it("rejects entering a non-perimeter cell", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.players[ai].hq.push(unit);
      d.grid[1][1].location = makeLocation({ ownerId: pid });
    });

    expect(() =>
      applyAction(state, {
        type: "enter",
        playerId: state.turn.activePlayerId,
        unitId: unitId!,
        row: 1,
        col: 1,
      }),
    ).toThrow("not on the grid perimeter");
  });

  it("rejects entering when boundary edge is blocked", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.players[ai].hq.push(unit);
      d.grid[0][0].location = makeLocation({
        ownerId: pid,
        edges: { n: false, e: false, s: false, w: false },
      });
    });

    expect(() =>
      applyAction(state, {
        type: "enter",
        playerId: state.turn.activePlayerId,
        unitId: unitId!,
        row: 0,
        col: 0,
      }),
    ).toThrow("no open edges facing the grid boundary");
  });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("move", () => {
  it("moves a unit to an adjacent cell with open facing edges", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][1].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
    });

    const { state: next, events } = applyAction(state, {
      type: "move",
      playerId: state.turn.activePlayerId,
      unitId: unitId!,
      row: 0,
      col: 1,
    });
    const ns = next as MainGameState;

    expect(ns.grid[0][0].units).toHaveLength(0);
    expect(ns.grid[0][1].units).toHaveLength(1);
    expect(ns.grid[0][1].units[0].id).toBe(unitId!);
    expect(events.some((e) => e.type === "unit_moved")).toBe(true);
  });

  it("rejects move when facing edges are blocked", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({
        ownerId: pid,
        edges: { n: true, e: false, s: true, w: true },
      });
      d.grid[0][1].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
    });

    expect(() =>
      applyAction(state, {
        type: "move",
        playerId: state.turn.activePlayerId,
        unitId: unitId!,
        row: 0,
        col: 1,
      }),
    ).toThrow("blocked");
  });

  it("costs 2 AP for injured units", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid, injured: true });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][1].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
    });

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: state.turn.activePlayerId,
      unitId: unitId!,
      row: 0,
      col: 1,
    });
    const ns = next as MainGameState;
    expect(ns.turn.actionPointsRemaining).toBe(1); // 3 - 2
  });

  it("allows retreat to HQ from perimeter with open boundary edge", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
    });

    const { state: next } = applyAction(state, {
      type: "move",
      playerId: state.turn.activePlayerId,
      unitId: unitId!,
      row: -1,
      col: -1,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(ns.grid[0][0].units).toHaveLength(0);
    expect(p.hq.some((c) => c.id === unitId!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// play_event
// ---------------------------------------------------------------------------

describe("play_event", () => {
  it("plays an instant event and discards it", () => {
    let eventId: string;
    const state = gameWith((d, ai, pid) => {
      const event = makeEvent({ ownerId: pid, subtype: "instant", cost: "0" });
      eventId = event.id;
      d.players[ai].hand.push(event);
    });

    const { state: next, events } = applyAction(state, {
      type: "play_event",
      playerId: state.turn.activePlayerId,
      cardId: eventId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(0);
    expect(p.discardPile).toHaveLength(1);
    expect(events.some((e) => e.type === "event_played")).toBe(true);
  });

  it("plays a passive event with duration tracking", () => {
    let eventId: string;
    const state = gameWith((d, ai, pid) => {
      const event = makeEvent({ ownerId: pid, subtype: "passive", cost: "0", duration: 3 });
      eventId = event.id;
      d.players[ai].hand.push(event);
    });

    const { state: next } = applyAction(state, {
      type: "play_event",
      playerId: state.turn.activePlayerId,
      cardId: eventId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(0);
    expect(p.passiveEvents).toHaveLength(1);
    expect(p.passiveEvents[0].remainingDuration).toBe(3);
  });

  it("plays a trap event face-down", () => {
    let eventId: string;
    const state = gameWith((d, ai, pid) => {
      const event = makeEvent({ ownerId: pid, subtype: "trap", cost: "0" });
      eventId = event.id;
      d.players[ai].hand.push(event);
    });

    const { state: next, events } = applyAction(state, {
      type: "play_event",
      playerId: state.turn.activePlayerId,
      cardId: eventId!,
      targetId: "some-target",
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.hand).toHaveLength(0);
    expect(p.activeTraps).toHaveLength(1);
    expect(p.activeTraps[0].card.id).toBe(eventId!);
    expect(p.activeTraps[0].targetId).toBe("some-target");
    expect(events.some((e) => e.type === "trap_set")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// equip
// ---------------------------------------------------------------------------

describe("equip", () => {
  it("equips an item in HQ to a unit in HQ", () => {
    let unitId: string;
    let itemId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      const item = makeItem({ ownerId: pid });
      unitId = unit.id;
      itemId = item.id;
      d.players[ai].hq.push(unit, item);
    });

    const { state: next, events } = applyAction(state, {
      type: "equip",
      playerId: state.turn.activePlayerId,
      itemId: itemId!,
      unitId: unitId!,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    const equipped = p.hq.find((c) => c.id === itemId!);

    expect(equipped?.type).toBe("item");
    expect((equipped as any).equippedTo).toBe(unitId!);
    expect(events.some((e) => e.type === "item_equipped")).toBe(true);
  });

  it("rejects equipping when unit and item are not co-located", () => {
    let unitId: string;
    let itemId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      const item = makeItem({ ownerId: pid });
      unitId = unit.id;
      itemId = item.id;
      d.players[ai].hq.push(unit);
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].items.push(item);
    });

    expect(() =>
      applyAction(state, {
        type: "equip",
        playerId: state.turn.activePlayerId,
        itemId: itemId!,
        unitId: unitId!,
      }),
    ).toThrow("not co-located");
  });
});

// ---------------------------------------------------------------------------
// raze
// ---------------------------------------------------------------------------

describe("raze", () => {
  it("destroys a location and all cards there", () => {
    let unitId: string;
    let replacementId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
      const replacement = makeLocation({ ownerId: pid });
      replacementId = replacement.id;
      d.players[ai].prospectDeck.push(replacement);
    });

    const { state: next, events } = applyAction(state, {
      type: "raze",
      playerId: state.turn.activePlayerId,
      unitId: unitId!,
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.discardPile.length).toBeGreaterThan(0);
    expect(ns.grid[0][0].location?.id).toBe(replacementId!);
    expect(ns.grid[0][0].units).toHaveLength(0);
    // Raze costs 3 AP (all), triggering auto-advance → AP reset to 3 for next player
    expect(events.some((e) => e.type === "turn_ended")).toBe(true);
    expect(events.some((e) => e.type === "location_razed")).toBe(true);
    expect(events.some((e) => e.type === "location_placed")).toBe(true);
  });

  it("rejects raze when enemy units are present", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      const other = otherPlayerId(d as unknown as MainGameState);
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit, makeUnit({ ownerId: other }));
    });

    expect(() =>
      applyAction(state, {
        type: "raze",
        playerId: state.turn.activePlayerId,
        unitId: unitId!,
        row: 0,
        col: 0,
      }),
    ).toThrow("enemy units present");
  });
});

// ---------------------------------------------------------------------------
// attack
// ---------------------------------------------------------------------------

describe("attack", () => {
  it("resolves combat between units at same location", () => {
    let attackerId: string;
    const state = gameWith((d, _ai, pid) => {
      const other = otherPlayerId(d as unknown as MainGameState);
      const attacker = makeUnit({ ownerId: pid, strength: 10 });
      attackerId = attacker.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(attacker, makeUnit({ ownerId: other, strength: 1 }));
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: state.turn.activePlayerId,
      unitIds: [attackerId!],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const types = events.map((e) => e.type);

    expect(types).toContain("combat_started");
    expect(types).toContain("combat_resolved");
    expect(ns.turn.actionPointsRemaining).toBe(2);
  });

  it("rejects attack with no enemy units", () => {
    let unitId: string;
    const state = gameWith((d, _ai, pid) => {
      const unit = makeUnit({ ownerId: pid });
      unitId = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(unit);
    });

    expect(() =>
      applyAction(state, {
        type: "attack",
        playerId: state.turn.activePlayerId,
        unitIds: [unitId!],
        row: 0,
        col: 0,
      }),
    ).toThrow("No enemy units");
  });

  it("rejects attack with empty unitIds", () => {
    const state = gameWith((d, _ai, pid) => {
      d.grid[0][0].location = makeLocation({ ownerId: pid });
    });

    expect(() =>
      applyAction(state, {
        type: "attack",
        playerId: state.turn.activePlayerId,
        unitIds: [],
        row: 0,
        col: 0,
      }),
    ).toThrow("at least one unit");
  });

  it("kills a vastly weaker defender", () => {
    let attackerId: string;
    let defenderId: string;
    let defenderOwner: string;
    const state = gameWith((d, _ai, pid) => {
      const other = otherPlayerId(d as unknown as MainGameState);
      defenderOwner = other;
      const attacker = makeUnit({ ownerId: pid, strength: 20 });
      const defender = makeUnit({ ownerId: other, strength: 1 });
      attackerId = attacker.id;
      defenderId = defender.id;
      d.grid[0][0].location = makeLocation({ ownerId: pid });
      d.grid[0][0].units.push(attacker, defender);
    });

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: state.turn.activePlayerId,
      unitIds: [attackerId!],
      row: 0,
      col: 0,
    });
    const ns = next as MainGameState;
    const p2 = ns.players.find((p) => p.id === defenderOwner!)!;

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
    expect(p2.discardPile.some((c) => c.id === defenderId!)).toBe(true);
    expect(ns.grid[0][0].units.every((u) => u.id !== defenderId!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// turn lifecycle
// ---------------------------------------------------------------------------

describe("turn lifecycle", () => {
  it("grants gold income at start of turn", () => {
    const state = createTestGame();
    const firstPlayer = state.turn.activePlayerId;
    const initialGold = state.players.find((p) => p.id === firstPlayer)!.gold;

    const { state: s1 } = applyAction(state, {
      type: "pass",
      playerId: firstPlayer,
    });
    const ns = s1 as MainGameState;
    const secondPlayer = ns.turn.activePlayerId;
    const secondPlayerGold = ns.players.find((p) => p.id === secondPlayer)!.gold;
    expect(secondPlayerGold).toBe(initialGold + 1);
  });

  it("resets AP at start of turn", () => {
    let cardId: string;
    const state = gameWith((d, ai, pid) => {
      const card = makeUnit({ ownerId: pid, cost: "0" });
      cardId = card.id;
      d.players[ai].hand.push(card);
    });

    // Deploy uses 1 AP (now at 2), then pass
    const { state: s1 } = applyAction(state, {
      type: "deploy",
      playerId: state.turn.activePlayerId,
      cardId: cardId!,
    });
    // Second player passes
    const { state: s2 } = applyAction(s1, {
      type: "pass",
      playerId: (s1 as MainGameState).turn.activePlayerId,
    });
    // Back to first player — AP should be 3
    const final = s2 as MainGameState;
    expect(final.turn.actionPointsRemaining).toBe(3);
  });

  it("heals injured units in HQ at start of turn", () => {
    let unitId: string;
    const state = gameWith((d, ai, pid) => {
      const unit = makeUnit({ ownerId: pid, injured: true });
      unitId = unit.id;
      d.players[ai].hq.push(unit);
    });

    // Pass both players to get back to first player's turn
    const { state: s1 } = applyAction(state, {
      type: "pass",
      playerId: state.turn.activePlayerId,
    });
    const { state: s2 } = applyAction(s1, {
      type: "pass",
      playerId: (s1 as MainGameState).turn.activePlayerId,
    });
    const ns = s2 as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    const healedUnit = p.hq.find((c) => c.id === unitId!) as UnitCard;
    expect(healedUnit).toBeDefined();
    expect(healedUnit.injured).toBe(false);
  });

  it("enforces hand size limit at end of turn", () => {
    const state = gameWith((d, ai, pid) => {
      for (let i = 0; i < 10; i++) {
        d.players[ai].hand.push(makeUnit({ ownerId: pid }));
      }
    });

    const { state: next } = applyAction(state, {
      type: "pass",
      playerId: state.turn.activePlayerId,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;
    expect(p.hand.length).toBeLessThanOrEqual(7);
  });

  it("auto-advances turn when AP exhausted", () => {
    const state = createTestGame();
    const firstPlayer = state.turn.activePlayerId;

    let s = state as MainGameState;
    for (let i = 0; i < 3; i++) {
      const { state: next } = applyAction(s, {
        type: "draw",
        playerId: s.turn.activePlayerId,
      });
      s = next as MainGameState;
    }

    expect(s.turn.activePlayerId).not.toBe(firstPlayer);
    expect(s.turn.actionPointsRemaining).toBe(3);
  });

  it("decrements passive event duration and expires them", () => {
    let eventId: string;
    const state = gameWith((d, ai, pid) => {
      const passiveEvent = makeEvent({
        ownerId: pid,
        subtype: "passive",
        cost: "0",
        duration: 1,
        remainingDuration: 1,
      });
      eventId = passiveEvent.id;
      d.players[ai].passiveEvents.push(passiveEvent);
    });

    const { state: next, events } = applyAction(state, {
      type: "pass",
      playerId: state.turn.activePlayerId,
    });
    const ns = next as MainGameState;
    const p = ns.players.find((p) => p.id === state.turn.activePlayerId)!;

    expect(p.passiveEvents).toHaveLength(0);
    expect(p.discardPile.some((c) => c.id === eventId!)).toBe(true);
    expect(events.some((e) => e.type === "passive_expired")).toBe(true);
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
      applyAction(state, {
        type: "draw",
        playerId: state.turn.activePlayerId,
      }),
    ).toThrow("Not enough AP");
  });
});
