import { describe, expect, it, beforeEach } from "bun:test";
import { produce } from "immer";
import type { Draft } from "immer";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import type { Action, GameEvent, MainGameState } from "../types";
import { emit } from "../listeners/emit";
import { rebuildListeners } from "../listeners/rebuild";
import { getModifiedStat, getModifiedCost, isUnitProtected, getModifiedAPCost } from "../listeners/query";
import type { EffectListener, QueryListener } from "../listeners/types";
import {
  createTestGame,
  makeUnit,
  makeLocation,
  makeItem,
  makePolicy,
  makePassiveEvent,
  makeTrapEvent,
  makeInstantEvent,
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
  it("returns empty result for a state with no registered effect cards", () => {
    const state = createTestGame();
    const result = rebuildListeners(state);
    expect(result.listeners).toEqual([]);
    expect(result.queries).toEqual([]);
  });

  it("returns listeners for a location with registered effects", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({
        ownerId: p.active,
        definitionId: "the-silk-road",
      });
    });
    const { listeners } = rebuildListeners(state);
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
    const { listeners } = rebuildListeners(state);
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
    const result = rebuildListeners(state);
    expect(result.listeners).toEqual([]);
    expect(result.queries).toEqual([]);
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

  it("emits trap_triggered BEFORE the trap's effect events (log reads trigger → effect)", () => {
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

    const { active, activeIdx } = getPlayers(state);
    const u = state.players[activeIdx].hq[0];

    const { events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: u.id,
      row: 0,
      col: 0,
    });

    const triggeredIdx = events.findIndex((e) => e.type === "trap_triggered");
    const injuredIdx = events.findIndex((e) => e.type === "unit_injured");
    expect(triggeredIdx).toBeGreaterThanOrEqual(0);
    expect(injuredIdx).toBeGreaterThanOrEqual(0);
    expect(triggeredIdx).toBeLessThan(injuredIdx);
  });

  it("highway-robbery: steals 2 gold from entering enemy unit's owner", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "highway-robbery",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
      d.players[p.activeIdx].gold = 5;
      d.players[p.otherIdx].gold = 3;
    });

    const { active, activeIdx, otherIdx } = getPlayers(state);
    const unit = state.players[activeIdx].hq[0];

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
    expect(ns.players[activeIdx].gold).toBe(5 - 2); // victim loses 2
    expect(ns.players[otherIdx].gold).toBe(3 + 2); // trap owner gains 2
  });

  it("highway-robbery: steals only available gold when victim has less than 2", () => {
    const state = gameWith((d, p) => {
      const trap = makeTrapEvent({
        ownerId: p.other,
        definitionId: "highway-robbery",
        trigger: "enemy_unit_enters_location",
      });
      const unit = makeUnit({ ownerId: p.active, strength: 8 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit);
      d.players[p.otherIdx].activeTraps.push({ card: trap });
      d.players[p.activeIdx].gold = 1;
      d.players[p.otherIdx].gold = 0;
    });

    const { active, activeIdx, otherIdx } = getPlayers(state);
    const unit = state.players[activeIdx].hq[0];

    const { state: next, events } = applyAction(state, {
      type: "enter",
      playerId: active,
      unitId: unit.id,
      row: 0,
      col: 0,
    });

    const ns = next as MainGameState;
    expect(events.some((e) => e.type === "trap_triggered")).toBe(true);
    expect(ns.players[activeIdx].gold).toBe(0); // had 1, lost 1
    expect(ns.players[otherIdx].gold).toBe(1); // gained 1
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

  it("Silk Road: bonus goes to player with units, not location owner", () => {
    const state = gameWith((d, p) => {
      // Location owned by other player, but active player has units there
      d.grid[0][0].location = makeLocation({ ownerId: p.other, definitionId: "the-silk-road" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { active } = getPlayers(state);
    const { events } = passBothPlayers(state);

    const goldEvent = events.find((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "the-silk-road"
    );
    expect(goldEvent).toBeDefined();
    expect("playerId" in goldEvent! && goldEvent.playerId).toBe(active);
  });

  it("Silk Road: no gold for location owner without units there", () => {
    const state = gameWith((d, p) => {
      // Location owned by active player, but only opponent has units
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-silk-road" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.other }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { events } = passBothPlayers(state);

    expect(events.some((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "the-silk-road"
    )).toBe(false);
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

  it("Trade Port: bonus goes to player with Diplomat, not location owner", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.other, definitionId: "trade-port" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, attributes: ["Diplomat"] }));
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });

    const { active } = getPlayers(state);
    const { events } = passBothPlayers(state);

    const goldEvent = events.find((e) =>
      e.type === "gold_changed" && "reason" in e && e.reason === "trade-port"
    );
    expect(goldEvent).toBeDefined();
    expect("playerId" in goldEvent! && goldEvent.playerId).toBe(active);
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

// ---------------------------------------------------------------------------
// Stat modifier queries
// ---------------------------------------------------------------------------

describe("stat modifier queries", () => {
  it("The Forge: +1 str at location, +0 elsewhere", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-forge" });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId, strength: 5 });

    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 })).toBe(6);
    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 1 })).toBe(5);
    expect(getModifiedStat(state, queries, unit, "cunning", { row: 0, col: 0 })).toBe(5);
  });

  it("Great Library: +1 cunning for Scientist only", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-great-library" });
    });
    const { queries } = rebuildListeners(state);
    const scientist = makeUnit({ ownerId: state.turn.activePlayerId, cunning: 4, attributes: ["Scientist"] });
    const warrior = makeUnit({ ownerId: state.turn.activePlayerId, cunning: 4, attributes: ["Warrior"] });

    expect(getModifiedStat(state, queries, scientist, "cunning", { row: 0, col: 0 })).toBe(5);
    expect(getModifiedStat(state, queries, warrior, "cunning", { row: 0, col: 0 })).toBe(4);
  });

  it("The Arena: +1 str attacker only, not defender", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-arena" });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId, strength: 5 });

    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(6);
    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 },
      { role: "defender", row: 0, col: 0 })).toBe(5);
  });

  it("Great Wall: +1 str defender only", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-great-wall" });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId, strength: 5 });

    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 },
      { role: "defender", row: 0, col: 0 })).toBe(6);
    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(5);
  });

  it("Ancient Scroll: +2 cunning to equipped unit", () => {
    const state = gameWith((d, p) => {
      const item = makeItem({ ownerId: p.active, definitionId: "ancient-scroll", equippedTo: "unit-1" });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].items.push(item);
    });
    const { queries } = rebuildListeners(state);
    const equipped = makeUnit({ id: "unit-1", ownerId: state.turn.activePlayerId, cunning: 3 });
    const other = makeUnit({ id: "unit-2", ownerId: state.turn.activePlayerId, cunning: 3 });

    expect(getModifiedStat(state, queries, equipped, "cunning", { row: 0, col: 0 })).toBe(5);
    expect(getModifiedStat(state, queries, other, "cunning", { row: 0, col: 0 })).toBe(3);
  });

  it("Philosopher's Stone: +2 to all stats for equipped unit", () => {
    const state = gameWith((d, p) => {
      const item = makeItem({ ownerId: p.active, definitionId: "philosophers-stone", equippedTo: "unit-1" });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].items.push(item);
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ id: "unit-1", ownerId: state.turn.activePlayerId, strength: 3, cunning: 3, charisma: 3 });

    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 })).toBe(5);
    expect(getModifiedStat(state, queries, unit, "cunning", { row: 0, col: 0 })).toBe(5);
    expect(getModifiedStat(state, queries, unit, "charisma", { row: 0, col: 0 })).toBe(5);
  });

  it("Arms Race: +2 str to owner's Warriors only", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.active, definitionId: "arms-race" }),
        remainingDuration: 2,
      });
    });
    const { active, other } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const myWarrior = makeUnit({ ownerId: active, strength: 4, attributes: ["Warrior"] });
    const myScientist = makeUnit({ ownerId: active, strength: 4, attributes: ["Scientist"] });
    const enemyWarrior = makeUnit({ ownerId: other, strength: 4, attributes: ["Warrior"] });

    expect(getModifiedStat(state, queries, myWarrior, "strength")).toBe(6);
    expect(getModifiedStat(state, queries, myScientist, "strength")).toBe(4);
    expect(getModifiedStat(state, queries, enemyWarrior, "strength")).toBe(4);
  });

  it("Plague: -2 str at target + adjacent, not further", () => {
    const targetLoc = makeLocation({ ownerId: "p1", definitionId: "test-location" });
    const state = gameWith((d, p) => {
      d.grid[1][1].location = targetLoc;
      d.grid[0][1].location = makeLocation({ ownerId: p.active }); // adjacent
      d.grid[0][0].location = makeLocation({ ownerId: p.active }); // diagonal (not adjacent)
      d.players[p.otherIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.other, definitionId: "plague" }),
        remainingDuration: 99,
        targetId: targetLoc.id,
      });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId, strength: 5 });

    expect(getModifiedStat(state, queries, unit, "strength", { row: 1, col: 1 })).toBe(3); // at target
    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 1 })).toBe(3); // adjacent
    expect(getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 })).toBe(5); // diagonal = not adjacent
  });

  it("multiple modifiers stack: Forge + Arms Race on Warrior", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-forge" });
      d.players[p.activeIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.active, definitionId: "arms-race" }),
        remainingDuration: 2,
      });
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const warrior = makeUnit({ ownerId: active, strength: 4, attributes: ["Warrior"] });

    // Forge +1 + Arms Race +2 = 4 + 3 = 7
    expect(getModifiedStat(state, queries, warrior, "strength", { row: 0, col: 0 })).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Cost modifier queries
// ---------------------------------------------------------------------------

describe("cost modifier queries", () => {
  it("The Bazaar: buy -1 with unit present, no discount without", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-bazaar" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const card = makeUnit({ ownerId: active, cost: "3" });

    expect(getModifiedCost(state, queries, card, active, "buy")).toBe(2);
    // Without unit at bazaar — use other player
    const { other } = getPlayers(state);
    expect(getModifiedCost(state, queries, card, other, "buy")).toBe(3);
  });

  it("Industrialist: first buy -1, second buy normal", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "industrialist" }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const card = makeUnit({ ownerId: active, cost: "3" });

    // No buys yet this turn — should get discount
    expect(getModifiedCost(state, queries, card, active, "buy")).toBe(2);

    // After a buy action in the log
    const stateWithBuy = produce(state, (d) => {
      d.actionLog.push({ type: "buy", playerId: active, cardId: "whatever" } as any);
    });
    const { queries: q2 } = rebuildListeners(stateWithBuy);
    expect(getModifiedCost(stateWithBuy, q2, card, active, "buy")).toBe(3);
  });

  it("Trade Embargo: opponent buys +2, own unaffected", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].passiveEvents.push({
        ...makePassiveEvent({ ownerId: p.active, definitionId: "trade-embargo" }),
        remainingDuration: 2,
      });
    });
    const { active, other } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const card = makeUnit({ ownerId: other, cost: "3" });

    expect(getModifiedCost(state, queries, card, other, "buy")).toBe(5);
    expect(getModifiedCost(state, queries, card, active, "buy")).toBe(3);
  });

  it("cost floor per-modifier: min 1 prevents going below 1", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-bazaar" });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const cheapCard = makeUnit({ ownerId: active, cost: "1" });

    // Bazaar -1 on cost 1, but min is 1
    expect(getModifiedCost(state, queries, cheapCard, active, "buy")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Protection queries
// ---------------------------------------------------------------------------

describe("protection queries", () => {
  it("Machu Picchu: protected from event_target", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "machu-picchu" });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId });

    expect(isUnitProtected(state, queries, unit, { row: 0, col: 0 }, "event_target")).toBe(true);
    expect(isUnitProtected(state, queries, unit, { row: 0, col: 1 }, "event_target")).toBe(false);
    expect(isUnitProtected(state, queries, unit, { row: 0, col: 0 }, "event_injury")).toBe(false);
  });

  it("The Catacombs: protected from event_injury", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "the-catacombs" });
    });
    const { queries } = rebuildListeners(state);
    const unit = makeUnit({ ownerId: state.turn.activePlayerId });

    expect(isUnitProtected(state, queries, unit, { row: 0, col: 0 }, "event_injury")).toBe(true);
    expect(isUnitProtected(state, queries, unit, { row: 0, col: 0 }, "event_target")).toBe(false);
  });

  it("Sherwood Forest: 7+ cunning protected from str contests, 6 cunning not", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, definitionId: "sherwood-forest" });
    });
    const { queries } = rebuildListeners(state);
    const highCunning = makeUnit({ ownerId: state.turn.activePlayerId, cunning: 7 });
    const lowCunning = makeUnit({ ownerId: state.turn.activePlayerId, cunning: 6 });

    expect(isUnitProtected(state, queries, highCunning, { row: 0, col: 0 }, "contest_target", "strength")).toBe(true);
    expect(isUnitProtected(state, queries, lowCunning, { row: 0, col: 0 }, "contest_target", "strength")).toBe(false);
    expect(isUnitProtected(state, queries, highCunning, { row: 0, col: 0 }, "contest_target", "cunning")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AP modifier queries
// ---------------------------------------------------------------------------

describe("AP modifier queries", () => {
  it("Pioneer: first move 0 AP, second move normal", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "pioneer" }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction = { type: "move" as const, playerId: active, unitId: "u1", row: 0, col: 1 };

    // First move — 0 AP
    expect(getModifiedAPCost(state, queries, moveAction, 1)).toBe(0);

    // After a move in the log — normal AP
    const stateWithMove = produce(state, (d) => {
      d.actionLog.push({ type: "move", playerId: active, unitId: "u1", row: 0, col: 1 } as any);
    });
    const { queries: q2 } = rebuildListeners(stateWithMove);
    expect(getModifiedAPCost(stateWithMove, q2, moveAction, 1)).toBe(1);
  });

  it("Mary Shelley: first play_event 0 AP, second play_event normal", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const playEventAction = { type: "play_event" as const, playerId: active, cardId: "e1" };

    // First event — 0 AP
    expect(getModifiedAPCost(state, queries, playEventAction, 1)).toBe(0);

    // After a play_event in the log — normal AP
    const stateWithEvent = produce(state, (d) => {
      d.actionLog.push({ type: "play_event", playerId: active, cardId: "e1" } as any);
    });
    const { queries: q2 } = rebuildListeners(stateWithEvent);
    expect(getModifiedAPCost(stateWithEvent, q2, playEventAction, 1)).toBe(1);
  });

  it("Mary Shelley: only affects own player's events", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
    });
    const { other } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const opponentPlayEvent = { type: "play_event" as const, playerId: other, cardId: "e1" };
    expect(getModifiedAPCost(state, queries, opponentPlayEvent, 1)).toBe(1);
  });

  it("Spymaster Infiltrate: activating the policy peeks an opponent's hand, sets viewPrompt, and spends 1 AP", () => {
    const initial = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "spymaster" }),
      );
      // Put some cards in the opponent's hand to be peeked.
      d.players[p.otherIdx].hand.push(
        makeInstantEvent({ ownerId: p.other }),
        makeInstantEvent({ ownerId: p.other }),
      );
    });
    const { active, other } = getPlayers(initial);
    const apBefore = initial.turn.actionPointsRemaining;
    const spymaster = initial.players.find((p) => p.id === active)!.activePolicies[0];

    const { state, events } = applyAction(initial, {
      type: "activate",
      playerId: active,
      cardId: spymaster.id,
      actionName: "Infiltrate",
    });
    const after = state as MainGameState;

    expect(after.turn.actionPointsRemaining).toBe(apBefore - 1);
    expect(after.viewPrompt?.playerId).toBe(active);
    expect(after.viewPrompt?.source).toBe("opponent_hand");
    expect(after.viewPrompt?.sourcePlayerId).toBe(other);
    expect(after.viewPrompt?.cards.length).toBe(2);
    const peeked = events.find((e) => e.type === "cards_peeked");
    expect(peeked).toBeDefined();
    expect((peeked as any).playerId).toBe(active);
    expect((peeked as any).cardIds.length).toBe(2);
    expect((peeked as any).source).toBe("opponent_hand");
  });

  it("Mary Shelley on the grid: first play_event still 0 AP (grid factory branch)", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].units.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const playEventAction = { type: "play_event" as const, playerId: active, cardId: "e1" };
    expect(getModifiedAPCost(state, queries, playEventAction, 1)).toBe(0);
  });

  it("Spymaster Infiltrate: not surfaced as a valid action when AP is insufficient", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "spymaster" }),
      );
      d.turn.actionPointsRemaining = 0;
    });
    const { active } = getPlayers(state);
    const validActions = getValidActions(state, active);
    const infiltrateActions = validActions.filter(
      (a: Action) => a.type === "activate" && a.actionName === "Infiltrate",
    );
    expect(infiltrateActions).toHaveLength(0);
  });

  it("Mary Shelley: getValidActions surfaces play_event at AP=0 (first event of turn)", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
      d.players[p.activeIdx].hand.push(
        makeInstantEvent({ ownerId: p.active, cost: "0" }),
      );
      d.turn.actionPointsRemaining = 0;
    });
    const { active } = getPlayers(state);
    const validActions = getValidActions(state, active);
    const playEvent = validActions.filter((a: Action) => a.type === "play_event");
    expect(playEvent.length).toBeGreaterThan(0);
  });

  it("Spymaster Infiltrate: empty opponent hand still emits cards_peeked and sets an empty viewPrompt", () => {
    const initial = gameWith((d, p) => {
      d.players[p.activeIdx].activePolicies.push(
        makePolicy({ ownerId: p.active, definitionId: "spymaster" }),
      );
      // opponent hand intentionally empty
    });
    const { active } = getPlayers(initial);
    const spymaster = initial.players.find((p) => p.id === active)!.activePolicies[0];
    const { state, events } = applyAction(initial, {
      type: "activate",
      playerId: active,
      cardId: spymaster.id,
      actionName: "Infiltrate",
    });
    const after = state as MainGameState;
    expect(after.viewPrompt?.cards).toEqual([]);
    const peeked = events.find((e) => e.type === "cards_peeked");
    expect(peeked).toBeDefined();
    expect((peeked as any).cardIds).toEqual([]);
    expect((peeked as any).source).toBe("opponent_hand");
  });

  it("Mary Shelley + Highway Robbery: per-cell enumeration all surface at AP=0", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
      d.players[p.activeIdx].hand.push(
        makeTrapEvent({
          ownerId: p.active,
          definitionId: "highway-robbery",
          trigger: "enemy_unit_enters_location",
          cost: "0",
        }),
      );
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[1][1].location = makeLocation({ ownerId: p.active });
      d.grid[2][2].location = makeLocation({ ownerId: p.active });
      d.turn.actionPointsRemaining = 0;
    });
    const { active } = getPlayers(state);
    const playEvent = getValidActions(state, active).filter(
      (a: Action) => a.type === "play_event",
    );
    expect(playEvent).toHaveLength(3);
    expect(playEvent.every((a) => "targetId" in a && a.targetId)).toBe(true);
  });

  it("Mary Shelley: applyAction(play_event) spends 0 AP for first event, 1 AP for second", () => {
    const initial = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, definitionId: "mary-shelley" }),
      );
      d.players[p.activeIdx].hand.push(
        makeInstantEvent({ ownerId: p.active, cost: "0" }),
        makeInstantEvent({ ownerId: p.active, cost: "0" }),
      );
    });
    const { active } = getPlayers(initial);
    const apBefore = initial.turn.actionPointsRemaining;

    const e1 = initial.players.find((p) => p.id === active)!.hand[0].id;
    const after1 = applyAction(initial, { type: "play_event", playerId: active, cardId: e1 }).state as MainGameState;
    expect(after1.turn.actionPointsRemaining).toBe(apBefore); // 0 AP for first event

    const e2 = after1.players.find((p) => p.id === active)!.hand[0].id;
    const after2 = applyAction(after1, { type: "play_event", playerId: active, cardId: e2 }).state as MainGameState;
    expect(after2.turn.actionPointsRemaining).toBe(apBefore - 1); // 1 AP for second event
  });
});
