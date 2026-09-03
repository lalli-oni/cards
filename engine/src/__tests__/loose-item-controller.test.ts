/**
 * Acceptance tests for deriving an item's controller from its bearer (#278).
 *
 * Players control units, not items. `controllerId` used to live on the item and
 * simply went stale when the item was put down, so a dropped item kept working
 * for whoever last carried it. Control is now read off the item's place:
 *
 *   equipped          → the bearer's controller
 *   HQ, unattached    → the HQ's player
 *   grid, unattached  → nobody
 *
 * Every test below sets `controllerId` on the item to the *wrong* player where
 * it can, so an assertion can only pass by deriving rather than by reading the
 * stale field.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { produce, type Draft } from "immer";
import { applyAction } from "../apply-action";
import { itemController } from "../item-helpers";
import { rebuildListeners } from "../listeners/rebuild";
import { killUnit } from "../unit-helpers";
import { ITEM_EFFECTS } from "../listeners/effects";
import { getModifiedStat } from "../listeners/query";
import { getVisibleState } from "../visible-state";
import type { ItemCard, MainGameState, UnitCard } from "../types";
import { getValidActions } from "../valid-actions";
import { createTestGame, makeItem, makeLocation, makeUnit, resetIds, runEffect } from "./helpers";

beforeEach(() => resetIds());

// SEED="test-seed" puts p2 first — same convention as main-actions.test.ts.
const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 0;

function gameWith(fn: (draft: Draft<MainGameState>) => void): MainGameState {
  return produce(createTestGame(), fn);
}

/** The derived controller of an item sitting at grid (0,0). */
function controllerAt00(state: MainGameState, itemId: string): string | undefined {
  const cell = state.grid[0][0];
  const item = cell.items.find((i) => i.id === itemId) as ItemCard;
  return itemController(item, { type: "grid", row: 0, col: 0 }, cell.units);
}

// ---------------------------------------------------------------------------
// The derivation table
// ---------------------------------------------------------------------------

describe("itemController — where control comes from", () => {
  it("an equipped item answers to its bearer, not to its own stale field", () => {
    // The item's stored controllerId names OTHER while its bearer is ACTIVE's.
    // Only derivation can return ACTIVE here.
    const bearer = makeUnit({ ownerId: ACTIVE });
    const item = makeItem({ ownerId: OTHER, equippedTo: bearer.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push({ ...item, controllerId: OTHER });
    });

    expect(controllerAt00(state, item.id)).toBe(ACTIVE);
  });

  it("a loose item on the grid is controlled by nobody", () => {
    // Same setup, no bearer — this is the case that used to go stale.
    const item = makeItem({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(makeUnit({ ownerId: ACTIVE }));
      d.grid[0][0].items.push({ ...item, controllerId: ACTIVE });
    });

    expect(controllerAt00(state, item.id)).toBeUndefined();
  });

  it("an unattached item in HQ is controlled by the HQ's player", () => {
    // HQ is private — there is no ground to lie on, and item activation (#130)
    // depends on an HQ item having a controller.
    const item = makeItem({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push({ ...item, controllerId: OTHER });
    });

    const hq = state.players[ACTIVE_IDX].hq;
    const stored = hq.find((c) => c.id === item.id) as ItemCard;
    expect(itemController(stored, { type: "hq", playerId: ACTIVE }, [])).toBe(ACTIVE);
  });

  it("a stale equippedTo naming an absent unit reads as loose on the grid", () => {
    // Every unit-removal path (killUnit, raze, mission completion, move,
    // retreat) either drops equipped items or carries them along, so this
    // should not arise in play — a killed bearer must not keep granting its
    // side the item if one of those paths regresses.
    const item = makeItem({ ownerId: ACTIVE, equippedTo: "ghost-unit" });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].items.push({ ...item, controllerId: ACTIVE });
    });

    expect(controllerAt00(state, item.id)).toBeUndefined();
  });

  it("a stale equippedTo naming an absent unit still resolves in HQ", () => {
    // HQ has no such gap: a private zone is unambiguously its own player's
    // regardless of who last held the item, so a stale attachment there
    // falls back to the HQ row instead of reading as loose.
    const item = makeItem({ ownerId: OTHER, equippedTo: "ghost-unit" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push({ ...item, controllerId: OTHER });
    });

    const hq = state.players[ACTIVE_IDX].hq;
    const stored = hq.find((c) => c.id === item.id) as ItemCard;
    expect(itemController(stored, { type: "hq", playerId: ACTIVE }, [])).toBe(ACTIVE);
  });

  it("an item equipped to a unit inside HQ answers to the bearer, not the HQ row", () => {
    // Equip is legal between a unit and item sharing an HQ position, so this is
    // reachable before either card ever reaches the grid. It takes the
    // equippedTo branch, not the HQ-unattached fallback — the stale field on
    // the item still names the wrong player to prove it.
    const bearer = makeUnit({ ownerId: ACTIVE });
    const item = makeItem({ ownerId: OTHER, equippedTo: bearer.id });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(bearer, { ...item, controllerId: OTHER });
    });

    const hqUnits = state.players[ACTIVE_IDX].hq.filter((c): c is UnitCard => c.type === "unit");
    const stored = state.players[ACTIVE_IDX].hq.find((c) => c.id === item.id) as ItemCard;
    expect(itemController(stored, { type: "hq", playerId: ACTIVE }, hqUnits)).toBe(ACTIVE);
  });
});

// ---------------------------------------------------------------------------
// Control follows the unit — the point of the change
// ---------------------------------------------------------------------------

describe("control moves with the bearer", () => {
  it("a mind-controlled unit brings its items with it, and gives them back", () => {
    // rules/README.md → Unit status → Controlled: the controller of a
    // controlled unit "may use the controlled unit's actions, move it, and
    // manage its items". execControl reassigns only the *unit*; deriving the
    // item's side is what makes that line true. The `control` verb —
    // Cleopatra's `diplomacy` is its only user in the library today.
    const theirUnit = makeUnit({ ownerId: OTHER });
    const theirItem = makeItem({ ownerId: OTHER, equippedTo: theirUnit.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(theirUnit);
      d.grid[0][0].items.push(theirItem);
    });
    expect(controllerAt00(state, theirItem.id)).toBe(OTHER);

    // The item was never touched by execControl — only its bearer was.
    const { state: controlled } = runEffect(state, "control(enemy)~turn", ACTIVE, {
      targetId: theirUnit.id,
    });
    expect(controllerAt00(controlled, theirItem.id)).toBe(ACTIVE);
    const stillTheirs = controlled.grid[0][0].items.find((i) => i.id === theirItem.id);
    expect(stillTheirs?.ownerId).toBe(OTHER);

    // "...and gives them back": ~turn expires after one pass, reverting the
    // unit's controllerId — and with it, the derived item controller.
    const { state: afterPass } = applyAction(controlled, { type: "pass", playerId: ACTIVE });
    expect(controllerAt00(afterPass as MainGameState, theirItem.id)).toBe(OTHER);
  });

  it("a mind-controlled unit's items can be transferred, permanently, by the controller", () => {
    // The concrete consequence of "manage its items": locateItemAction used to
    // reject unequip/transfer on a controlled-but-not-owned unit's gear,
    // because the item's *stored* controllerId still named the original
    // owner. Deriving from the bearer is what makes this legal — and it is a
    // permanent capture: transferring the item off the (soon to revert) unit
    // means it survives the control override expiring, unlike the unit
    // itself, which reverts to OTHER.
    const theirUnit = makeUnit({ ownerId: OTHER });
    const theirItem = makeItem({ ownerId: OTHER, equippedTo: theirUnit.id });
    const myUnit = makeUnit({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(theirUnit, myUnit);
      d.grid[0][0].items.push(theirItem);
      d.turn.actionPointsRemaining = 5;
    });

    const { state: controlled } = runEffect(state, "control(enemy)~turn", ACTIVE, {
      targetId: theirUnit.id,
    });

    const { state: transferred } = applyAction(
      controlled, { type: "transfer", playerId: ACTIVE, itemId: theirItem.id, unitId: myUnit.id },
    );
    const ts = transferred as MainGameState;
    const captured = ts.grid[0][0].items.find((i) => i.id === theirItem.id);
    expect(captured?.equippedTo).toBe(myUnit.id);

    const { state: afterPass } = applyAction(ts, { type: "pass", playerId: ACTIVE });
    const ns = afterPass as MainGameState;
    const bearerAfter = ns.grid[0][0].units.find((u) => u.id === theirUnit.id);
    expect(bearerAfter?.controllerId).toBe(OTHER);
    expect(ns.grid[0][0].items.find((i) => i.id === theirItem.id)?.equippedTo).toBe(myUnit.id);
  });

  it("equipping a loose item takes control of it without writing to the card", () => {
    // handleEquip used to set item.controllerId on pickup. That write is gone;
    // the attachment *is* the control change. Asserting the field stays put is
    // what stops the write being reintroduced.
    const mine = makeUnit({ ownerId: ACTIVE });
    const loose = makeItem({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(mine);
      d.grid[0][0].items.push({ ...loose, controllerId: OTHER });
    });
    expect(controllerAt00(state, loose.id)).toBeUndefined();

    const { state: next } = applyAction(
      state, { type: "equip", playerId: ACTIVE, itemId: loose.id, unitId: mine.id },
    );
    const ns = next as MainGameState;

    expect(controllerAt00(ns, loose.id)).toBe(ACTIVE);
    const taken = ns.grid[0][0].items.find((i) => i.id === loose.id);
    expect(taken?.controllerId).toBe(OTHER);
  });

  it("killing the bearer leaves its items loose and uncontrolled", () => {
    // "An item becomes stored when unequipped at a location, or when its bearer
    // is killed" (rules/README.md → Unit status → Killed). dropEquippedItems
    // clears the attachment, so this exercises the real death path rather than
    // a hand-built stale pointer — the item is left for either side to take.
    //
    // The item's ownerId (and so its stale controllerId) names OTHER while
    // its bearer is ACTIVE's, so the pre-death assertion below can only pass
    // by deriving from the bearer.
    const bearer = makeUnit({ ownerId: ACTIVE });
    const gear = makeItem({ ownerId: OTHER, equippedTo: bearer.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(gear);
    });
    expect(controllerAt00(state, gear.id)).toBe(ACTIVE);

    const afterDeath = produce(state, (d) => {
      const cell = d.grid[0][0];
      const target = cell.units.find((u) => u.id === bearer.id)!;
      killUnit(d, cell, target, 0, 0, () => {});
    });

    const dropped = afterDeath.grid[0][0].items.find((i) => i.id === gear.id);
    expect(dropped?.equippedTo).toBeUndefined();
    expect(controllerAt00(afterDeath, gear.id)).toBeUndefined();
  });

  it("unequipping on the grid drops control entirely", () => {
    // ownerId (and the stale controllerId it seeds) names OTHER so the
    // pre-unequip assertion can only pass by deriving from the bearer.
    const mine = makeUnit({ ownerId: ACTIVE });
    const borne = makeItem({ ownerId: OTHER, equippedTo: mine.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(mine);
      d.grid[0][0].items.push(borne);
    });
    expect(controllerAt00(state, borne.id)).toBe(ACTIVE);

    const { state: next } = applyAction(
      state, { type: "unequip", playerId: ACTIVE, itemId: borne.id },
    );

    expect(controllerAt00(next as MainGameState, borne.id)).toBeUndefined();
  });

  it("unequipping in HQ keeps control with the HQ's player", () => {
    // The grid test above shows unequip dropping control entirely. HQ is the
    // one place that doesn't happen: a private zone is unambiguously its own
    // player's, so an item left there stays controlled and stays activatable
    // — the behavioural difference the HQ row exists to produce.
    const mine = makeUnit({ ownerId: ACTIVE });
    const borne = makeItem({
      ownerId: OTHER, equippedTo: mine.id,
      actions: [{ name: "transmute", apCost: 1, effect: "gold[3]" }],
    });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mine, borne);
    });

    const { state: next } = applyAction(
      state, { type: "unequip", playerId: ACTIVE, itemId: borne.id },
    );
    const ns = next as MainGameState;

    const hqUnits = ns.players[ACTIVE_IDX].hq.filter((c): c is UnitCard => c.type === "unit");
    const dropped = ns.players[ACTIVE_IDX].hq.find((c) => c.id === borne.id) as ItemCard;
    expect(itemController(dropped, { type: "hq", playerId: ACTIVE }, hqUnits)).toBe(ACTIVE);

    const offered = getValidActions(ns, ACTIVE)
      .filter((a) => ("itemId" in a && a.itemId === borne.id)
        || ("cardId" in a && a.cardId === borne.id));
    expect(offered.some((a) => a.type === "activate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Listeners and queries under an absent controller
// ---------------------------------------------------------------------------

describe("effects with no controller", () => {
  it("war-banner's equipped buff answers to its bearer's side, not the item's", () => {
    // Nothing is stolen here — the bearer is ACTIVE's throughout. It's the
    // item's ownerId (and stale controllerId) that names OTHER, so the buff
    // can only land by reading the bearer's side. The equipped half reads
    // ctx.unit.controllerId === controllerId, so this is the sharpest check
    // that the factory received the bearer's side, not the item's.
    const bearer = makeUnit({ ownerId: ACTIVE, strength: 3 });
    const banner = makeItem({
      ownerId: OTHER, definitionId: "war-banner", equippedTo: bearer.id,
    });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push({ ...banner, controllerId: OTHER });
    });

    const { queries } = rebuildListeners(state);
    const unit = state.grid[0][0].units[0] as UnitCard;
    const buffed = getModifiedStat(state, queries, unit, "strength", { row: 0, col: 0 });
    expect(buffed).toBe(4);
  });

  it("war-banner's query source carries no controller once the banner is loose", () => {
    // The stat buff itself was already 0 for a loose item before #278 — the
    // equipped-half modifier has always gated on item.equippedTo. What #278
    // changes is the *attribution*: the query's source.controllerId, which
    // main.ts's rebuildListeners used to read straight off item.controllerId
    // (always defined) and now derives (undefined once loose). That's the
    // only thing this test can pin that a revert would actually break.
    const unit = makeUnit({ ownerId: ACTIVE, strength: 3 });
    const banner = makeItem({ ownerId: ACTIVE, definitionId: "war-banner" });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push({ ...banner, controllerId: ACTIVE });
    });

    const { queries } = rebuildListeners(state);
    const target = state.grid[0][0].units[0] as UnitCard;
    expect(getModifiedStat(state, queries, target, "strength", { row: 0, col: 0 })).toBe(3);

    const bannerQuery = queries.find((q) => q.source.cardId === banner.id);
    expect(bannerQuery?.source.controllerId).toBeUndefined();
  });

  it("a per-turn gold listener follows a real controller change, not just static derivation", () => {
    // The tests above check itemController's return value directly. This one
    // checks the thing that actually matters to a player: goldPerTurn closes
    // over its payee at rebuild time, so the open question is whether a
    // rebuild after the bearer's controller changes picks up the new payee —
    // the exact staleness #278 exists to kill. (A `control` cast's duration
    // always expires at the same turn boundary a turn_started for the new
    // controller would fire on, so a temporary control override can never be
    // observed live through this listener; mutating controllerId directly
    // models a permanent change, e.g. a bought or transferred bearer.)
    const bearer = makeUnit({ ownerId: OTHER });
    const ledger = makeItem({
      ownerId: OTHER, definitionId: "merchant-ledger", equippedTo: bearer.id,
    });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(ledger);
    });
    const beforeListener = rebuildListeners(state).listeners.find((l) => l.source.cardId === ledger.id);
    expect(beforeListener?.source.controllerId).toBe(OTHER);

    const changed = produce(state, (d) => {
      d.grid[0][0].units.find((u) => u.id === bearer.id)!.controllerId = ACTIVE;
      d.players[ACTIVE_IDX].mainDeck.push(makeUnit({ ownerId: ACTIVE }));
      d.players[1].mainDeck.push(makeUnit({ ownerId: OTHER }));
    });
    const { listeners: afterListeners } = rebuildListeners(changed);
    const afterListener = afterListeners.find((l) => l.source.cardId === ledger.id);
    expect(afterListener?.source.controllerId).toBe(ACTIVE);

    const { state: s1 } = applyAction(changed, { type: "pass", playerId: ACTIVE });
    const { events } = applyAction(s1, { type: "pass", playerId: OTHER });
    const goldEvent = events.find((e) => e.type === "gold_changed" && "reason" in e
      && e.reason === "merchant-ledger");
    expect(goldEvent && "playerId" in goldEvent ? goldEvent.playerId : undefined).toBe(ACTIVE);
  });

  it("rebuildListeners and computeReveals survive every ITEM_EFFECTS factory, loose and in HQ", () => {
    // A cheap sweep: any ITEM_EFFECTS factory that dereferences its controllerId
    // instead of gating on it throws here rather than in a card-specific test.
    // The HQ copies are not loose (an unattached HQ item has a controller —
    // the HQ's player), so they exercise the ordinary controlled path; only
    // the grid copies are the "nobody controls this" case.
    const definitionIds = Object.keys(ITEM_EFFECTS);
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      for (const definitionId of definitionIds) {
        d.grid[0][0].items.push(makeItem({ ownerId: ACTIVE, definitionId }));
        d.players[ACTIVE_IDX].hq.push(makeItem({ ownerId: ACTIVE, definitionId }));
      }
    });

    expect(definitionIds.length).toBeGreaterThan(0);
    const { listeners, queries } = rebuildListeners(state);
    // getVisibleState is the public path into computeReveals, which runs every
    // item factory a second time for its reveals provider.
    expect(() => getVisibleState(state, ACTIVE)).not.toThrow();

    // rebuildListeners only constructs listeners — it never evaluates a
    // listener's condition/apply, so this alone would not catch a factory
    // that builds a listener paying an undefined controller. Confirm every
    // grid-loose item's contribution carries no controller...
    const grid00ItemIds = new Set(state.grid[0][0].items.map((i) => i.id));
    for (const l of listeners) {
      if (l.source.type === "item" && grid00ItemIds.has(l.source.cardId)) {
        expect(l.source.controllerId).toBeUndefined();
      }
    }
    for (const q of queries) {
      if (q.source.type === "item" && grid00ItemIds.has(q.source.cardId)) {
        expect(q.source.controllerId).toBeUndefined();
      }
    }

    // ...and then actually fire a turn, so a factory that built a listener
    // dereferencing that undefined controller (e.g. via getPlayerById) throws
    // here instead of only in a future card-specific test.
    const { state: s1 } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const { events } = applyAction(s1, { type: "pass", playerId: OTHER });
    const itemGoldEvents = events.filter((e) =>
      e.type === "gold_changed" && "reason" in e && definitionIds.includes(e.reason));
    expect(itemGoldEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Raze destination — items to the razer, units to their controllers
// ---------------------------------------------------------------------------

describe("raze discards items to the razing player", () => {
  it("a loose item at a razed cell goes to the razer, not its owner", () => {
    // rules/README.md → Player turn → Raze row says only that items "are
    // discarded"; this matches mission completion (→ Missions), the other
    // rule for a wiped cell, which routes to the acting player "regardless of
    // original ownership".
    const razer = makeUnit({ ownerId: ACTIVE });
    const theirItem = makeItem({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(razer);
      d.grid[0][0].items.push({ ...theirItem, controllerId: OTHER });
      d.turn.actionPointsRemaining = 5;
    });

    const { state: next, events } = applyAction(
      state, { type: "raze", playerId: ACTIVE, unitId: razer.id, row: 0, col: 0 },
    );
    const ns = next as MainGameState;

    const activePile = ns.players.find((p) => p.id === ACTIVE)?.discardPile ?? [];
    const otherPile = ns.players.find((p) => p.id === OTHER)?.discardPile ?? [];
    expect(activePile.some((c) => c.id === theirItem.id)).toBe(true);
    expect(otherPile.some((c) => c.id === theirItem.id)).toBe(false);

    // The discard is self-documenting in the event log — a player watching
    // their opponent's item land in the razer's pile should be able to see
    // why, not just that it happened.
    expect(events.some((e) =>
      e.type === "card_discarded" && e.cardId === theirItem.id
      && e.playerId === ACTIVE && e.reason === "raze"
    )).toBe(true);
  });

  it("a razed unit routes to its controller, which raze's enemy-unit bar makes the razer", () => {
    // Units and items deliberately use different routing rules: control of a
    // unit is bought, stolen or won, so a unit goes home to whoever holds it
    // (the loop is keyed on controllerId); nobody earns a loose item, so items
    // go to the razer unconditionally (see the test above). Raze bars enemy
    // units, so for a razed unit controllerId is always the razer — the two
    // rules coincide here and cannot be told apart by a raze test. This pins
    // that the unit path stays keyed on controllerId rather than being
    // collapsed to match the item path, so the distinction survives a future
    // refactor even though it has no observable effect today.
    const razer = makeUnit({ ownerId: ACTIVE });
    const borrowed = makeUnit({ ownerId: OTHER, controllerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(razer, borrowed);
      d.turn.actionPointsRemaining = 5;
    });

    const { state: next } = applyAction(
      state, { type: "raze", playerId: ACTIVE, unitId: razer.id, row: 0, col: 0 },
    );
    const ns = next as MainGameState;

    const activePile = ns.players.find((p) => p.id === ACTIVE)?.discardPile ?? [];
    expect(activePile.some((c) => c.id === borrowed.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A loose item may be taken, not operated (rules/README.md → Items)
// ---------------------------------------------------------------------------

describe("a loose item is exposed for pickup, not for use", () => {
  it("offers equip on an opponent's dropped item, but never activate", () => {
    // ownerId names OTHER, but the stale controllerId is set to ACTIVE — the
    // wrong player on purpose. On main, valid-actions.ts's old
    // `i.controllerId === playerId` filter would have offered activate here
    // (ACTIVE's own unit is co-located and the stale field says ACTIVE); only
    // deriving "loose ⇒ no controller" makes the activate assertion below
    // fail, which is what proves this test guards the real behavior change.
    //
    // A co-located friendly unit may still take the item
    // (rules/README.md → Items → Stored). What it may not do is operate it in
    // place: that right arrives with the pickup. getValidActions enumerates
    // only for the active player (bar a suspended-combat decider), so
    // ACTIVE's view is the whole test.
    const stone = makeItem({
      ownerId: OTHER,
      definitionId: "philosophers-stone",
      actions: [{ name: "transmute", apCost: 1, effect: "gold[3]" }],
    });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(makeUnit({ ownerId: ACTIVE }), makeUnit({ ownerId: OTHER }));
      d.grid[0][0].items.push({ ...stone, controllerId: ACTIVE });
    });

    const offered = getValidActions(state, ACTIVE)
      .filter((a) => ("itemId" in a && a.itemId === stone.id)
        || ("cardId" in a && a.cardId === stone.id));
    expect(offered.some((a) => a.type === "equip")).toBe(true);
    expect(offered.some((a) => a.type === "activate")).toBe(false);
  });
});
