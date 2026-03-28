import { describe, expect, it, beforeEach } from "bun:test";
import { produce } from "immer";
import type { Draft } from "immer";
import { applyAction } from "../apply-action";
import type { GameEvent, MainGameState } from "../types";
import { emit } from "../listeners/emit";
import { rebuildListeners } from "../listeners/rebuild";
import type { EffectListener } from "../listeners/types";
import {
  createTestGame,
  makeUnit,
  makeLocation,
  makeItem,
  makePolicy,
  makePassiveEvent,
  makeTrapEvent,
  resetIds,
} from "./helpers";

/** Get active and other player IDs from a game state. */
function getPlayers(state: MainGameState) {
  const active = state.turn.activePlayerId;
  const other = state.players.find((p) => p.id !== active)!.id;
  const activeIdx = state.players.findIndex((p) => p.id === active);
  const otherIdx = state.players.findIndex((p) => p.id === other);
  return { active, other, activeIdx, otherIdx };
}

/** Create a test game and apply mutations with player-aware helpers. */
function gameWith(
  mutate: (d: Draft<MainGameState>, p: ReturnType<typeof getPlayers>) => void,
): MainGameState {
  const base = createTestGame();
  const players = getPlayers(base);
  return produce(base, (d) => mutate(d, players));
}

beforeEach(() => resetIds());

// ---------------------------------------------------------------------------
// emit() system
// ---------------------------------------------------------------------------

describe("emit", () => {
  it("pushes event to events array", () => {
    const state = createTestGame();
    const { active } = getPlayers(state);
    const events: GameEvent[] = [];
    produce(state, (draft) => {
      emit(draft, { type: "turn_ended", playerId: active }, [], events);
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_ended");
  });

  it("fires matching listeners and logs secondary events", () => {
    const state = createTestGame();
    const { active } = getPlayers(state);
    const events: GameEvent[] = [];
    const listeners: EffectListener[] = [{
      source: { type: "policy", cardId: "test", definitionId: "test", ownerId: active },
      on: "turn_started",
      apply: (draft, _event, emitFn) => {
        const player = draft.players.find((p) => p.id === active)!;
        player.gold += 1;
        emitFn({ type: "gold_changed", playerId: active, amount: 1, reason: "test" });
      },
    }];

    produce(state, (draft) => {
      emit(draft, { type: "turn_started", playerId: active, round: 1 }, listeners, events);
    });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("turn_started");
    expect(events[1].type).toBe("gold_changed");
  });

  it("chains: secondary events from listeners trigger further listeners", () => {
    const state = createTestGame();
    const { active } = getPlayers(state);
    const events: GameEvent[] = [];
    let chainedCalled = false;

    const listeners: EffectListener[] = [
      {
        source: { type: "policy", cardId: "a", definitionId: "first", ownerId: active },
        on: "turn_started",
        apply: (_draft, _event, emitFn) => {
          emitFn({ type: "unit_healed", playerId: active, unitId: "fake" });
        },
      },
      {
        source: { type: "policy", cardId: "b", definitionId: "second", ownerId: active },
        on: "unit_healed",
        apply: () => { chainedCalled = true; },
      },
    ];

    produce(state, (draft) => {
      emit(draft, { type: "turn_started", playerId: active, round: 1 }, listeners, events);
    });

    expect(chainedCalled).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("turn_started");
    expect(events[1].type).toBe("unit_healed");
  });

  it("skips listeners that don't match the event type", () => {
    const state = createTestGame();
    const { active } = getPlayers(state);
    const events: GameEvent[] = [];
    let called = false;
    const listeners: EffectListener[] = [{
      source: { type: "policy", cardId: "test", definitionId: "test", ownerId: active },
      on: "combat_resolved",
      apply: () => { called = true; },
    }];

    produce(state, (draft) => {
      emit(draft, { type: "turn_started", playerId: active, round: 1 }, listeners, events);
    });

    expect(called).toBe(false);
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// rebuildListeners
// ---------------------------------------------------------------------------

describe("rebuildListeners", () => {
  it("returns empty array for a state with no registered effect cards", () => {
    const state = createTestGame();
    expect(rebuildListeners(state)).toEqual([]);
  });

  it("returns listeners for a location with registered effects", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({
        ownerId: p.active,
        definitionId: "the-silk-road",
      });
    });
    const listeners = rebuildListeners(state);
    expect(listeners.length).toBeGreaterThan(0);
    expect(listeners[0].source.definitionId).toBe("the-silk-road");
  });

  it("returns listeners for policies and traps", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "scholar" }),
      );
      d.players[p.otherIdx].activeTraps.push({
        card: makeTrapEvent({
          ownerId: p.other,
          definitionId: "ambush",
          trigger: "enemy_unit_enters_location",
        }),
      });
    });
    const listeners = rebuildListeners(state);
    const defIds = listeners.map((l) => l.source.definitionId);
    expect(defIds).toContain("scholar");
    expect(defIds).toContain("ambush");
  });

  it("silently skips cards without registered effects", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({
        ownerId: p.active,
        definitionId: "unknown-location",
      });
    });
    expect(rebuildListeners(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trap listeners (integration)
// ---------------------------------------------------------------------------

describe("trap listeners", () => {
  it("ambush: injures entering enemy unit", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "ambush",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
    });

    const { active, otherIdx } = getPlayers(state);
    const unit = state.players[getPlayers(state).activeIdx].hq[0];

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) => e.type === "unit_injured" || e.type === "unit_killed")).toBe(true);
    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
    expect(ns.players[otherIdx].activeTraps).toHaveLength(0);
  });

  it("ambush: kills already-injured unit", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "ambush",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8, injured: true });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
    });

    const { active } = getPlayers(state);
    const unit = state.players[getPlayers(state).activeIdx].hq[0];

    const { events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
  });

  it("assassination-attempt: kills weak unit (str ≤ 6)", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "assassination-attempt",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
    });

    const { active } = getPlayers(state);
    const unit = state.players[getPlayers(state).activeIdx].hq[0];

    const { events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
  });

  it("assassination-attempt: injures strong unit (str > 6)", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "assassination-attempt",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
    });

    const { active } = getPlayers(state);
    const unit = state.players[getPlayers(state).activeIdx].hq[0];

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    const enteredUnit = ns.grid[0][0].units.find((u) => u.id === unit.id);
    expect(enteredUnit?.injured).toBe(true);
    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
  });

  it("does not fire for own units", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.active,
        definitionId: "ambush",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.activeIdx].activeTraps.push({ card: trap });
    });

    const { active, activeIdx } = getPlayers(state);
    const unit = state.players[activeIdx].hq[0];

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) => e.type === "trap_triggered")).toBe(false);
    expect(ns.players[activeIdx].activeTraps).toHaveLength(1);
  });

  it("targetId filtering: only fires at matching location", () => {
    const state = gameWith((d, p) => {
      const targetLoc = makeLocation({ ownerId: p.active });
      const otherLoc = makeLocation({ ownerId: p.active });
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "ambush",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = otherLoc;  // not the target
      d.grid[0][1].location = targetLoc; // the target
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap, targetId: targetLoc.id });
    });

    const { active, otherIdx } = getPlayers(state);
    const unit = state.players[getPlayers(state).activeIdx].hq[0];

    // Enter at non-target location — trap should NOT fire
    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) => e.type === "trap_triggered")).toBe(false);
    expect(ns.players[otherIdx].activeTraps).toHaveLength(1);
  });

  it("fires on move to new cell", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "ambush",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
    });

    const { active } = getPlayers(state);
    const unit = state.grid[0][0].units[0];

    const { events } = applyAction(state, {
      type: "move",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 1,
    });

    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Turn-start listeners
// ---------------------------------------------------------------------------

describe("turn-start listeners", () => {
  /** Helper: pass both players to trigger active player's next turn start. */
  function passBothPlayers(state: MainGameState) {
    const { active, other } = getPlayers(state);
    const { state: s1 } = applyAction(state, { type: "pass", playerId: active });
    const { state: s2, events } = applyAction(s1, { type: "pass", playerId: other });
    return { state: s2 as MainGameState, events };
  }

  it("Silk Road: +1 gold when units present at location", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-silk-road" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "the-silk-road"
    )).toBe(true);
  });

  it("Silk Road: no gold when no units at location", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-silk-road" });
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "the-silk-road"
    )).toBe(false);
  });

  it("Trade Port: +1 gold with Diplomat present", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "trade-port" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, attributes: ["Diplomat"] }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "trade-port"
    )).toBe(true);
  });

  it("Trade Port: no gold without Diplomat", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "trade-port" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, attributes: ["Warrior"] }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "trade-port"
    )).toBe(false);
  });

  it("Golden Age: +1 gold per turn for owner", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.active, definitionId: "golden-age" }),
        remainingDuration: 3,
      });
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "golden-age"
    )).toBe(true);
  });

  it("Scholar: +1 extra card draw at turn start", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "scholar" }),
      );
      for (let i = 0; i < 5; i++) {
        d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      }
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { active } = getPlayers(state);
    const { events } = passBothPlayers(state);

    // Scholar adds an extra card_drawn event for the active player
    const drawEvents = events.filter((e) =>
      e.type === "card_drawn" && "playerId" in e && e.playerId === active
    );
    expect(drawEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("Merchant Ledger: +2 gold at turn start", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, definitionId: "merchant-ledger" }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    const goldEvents = events.filter((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "merchant-ledger"
    );
    expect(goldEvents).toHaveLength(1);
    expect((goldEvents[0] as any).amount).toBe(2);
  });

  it("Trade Goods: +1 gold at turn start", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, definitionId: "trade-goods" }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "trade-goods"
    )).toBe(true);
  });

  it("multiple turn-start effects accumulate", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, definitionId: "trade-goods" }));
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, definitionId: "merchant-ledger" }));
      d.players[p.activeIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.active, definitionId: "golden-age" }),
        remainingDuration: 3,
      });
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { activeIdx } = getPlayers(state);
    const goldBefore = state.players[activeIdx].gold;

    const { state: ns } = passBothPlayers(state);

    // base income (1) + trade-goods (1) + merchant-ledger (2) + golden-age (1) = 5
    expect(ns.players[activeIdx].gold).toBe(goldBefore + 5);
  });
});

// ---------------------------------------------------------------------------
// Combat & heal reward listeners
// ---------------------------------------------------------------------------

describe("combat reward listeners", () => {
  it("Warlord: +1 gold when own unit wins combat", () => {
    const state = gameWith((d, p) => {
      const attacker = makeUnit({ ownerId: p.active, strength: 10 });
      const defender = makeUnit({ ownerId: p.other, strength: 1 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "warlord" }),
      );
    });

    const { active, activeIdx } = getPlayers(state);
    const attacker = state.grid[0][0].units.find((u) => u.ownerId === active)!;
    const goldBefore = state.players[activeIdx].gold;

    const { state: next, events } = applyAction(state, {
      type: "attack",
      playerId: active,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "warlord"
    )).toBe(true);
    expect(ns.players[activeIdx].gold).toBe(goldBefore + 1);
  });
});

describe("heal reward listeners", () => {
  it("Healer: +1 gold when unit healed", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, injured: true }));
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "healer" }),
      );
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { activeIdx } = getPlayers(state);
    const goldBefore = state.players[activeIdx].gold;

    const { active, other } = getPlayers(state);
    const { state: s1 } = applyAction(state, { type: "pass", playerId: active });
    const { state: s2, events } = applyAction(s1, { type: "pass", playerId: other });

    const ns = s2 as MainGameState;
    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "healer"
    )).toBe(true);
    // base income (1) + healer bonus (1) = 2 more gold
    expect(ns.players[activeIdx].gold).toBe(goldBefore + 2);
  });
});
