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
import { fromState } from "../rng";
import { executeEffect, type ExecutionContext } from "../effect-dsl/executor";
import type { GameEvent, ItemCard, MainGameState, UnitCard } from "../types";
import { getValidActions } from "../valid-actions";
import { createTestGame, makeItem, makeLocation, makeUnit, resetIds } from "./helpers";

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
    // Same card, same cell, no bearer — this is the case that used to go stale.
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

  it("a stale equippedTo naming an absent unit reads as loose", () => {
    // Defensive: an attachment pointing at a unit that is no longer in the cell
    // must not resolve to a controller, or a killed bearer would keep granting
    // its side the item.
    const item = makeItem({ ownerId: ACTIVE, equippedTo: "ghost-unit" });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].items.push({ ...item, controllerId: ACTIVE });
    });

    expect(controllerAt00(state, item.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Control follows the unit — the point of the change
// ---------------------------------------------------------------------------

describe("control moves with the bearer", () => {
  it("a mind-controlled unit brings its items with it, and gives them back", () => {
    // rules/README.md:308 — the controller of a controlled unit "may use the
    // controlled unit's actions, move it, and manage its items". execControl
    // reassigns only the *unit*; deriving the item's side is what makes that
    // line true. Cleopatra's `diplomacy` is the only shipped card that gets here.
    const theirUnit = makeUnit({ ownerId: OTHER });
    const theirItem = makeItem({ ownerId: OTHER, equippedTo: theirUnit.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(theirUnit);
      d.grid[0][0].items.push(theirItem);
    });
    expect(controllerAt00(state, theirItem.id)).toBe(OTHER);

    const events: GameEvent[] = [];
    const { queries } = rebuildListeners(state);
    const controlled = produce(state, (draft) => {
      const rng = fromState(draft.rngState);
      const ctx: ExecutionContext = {
        draft,
        playerId: ACTIVE,
        actingCardSource: { type: "unit", cardId: "test-actor", definitionId: "test-actor" },
        emit: (e) => { events.push(e); },
        events,
        queries,
        rng,
        targetId: theirUnit.id,
      };
      executeEffect("control(enemy)~turn", ctx);
    });

    // The item was never touched by execControl — only its bearer was.
    expect(controllerAt00(controlled, theirItem.id)).toBe(ACTIVE);
    const stillTheirs = controlled.grid[0][0].items.find((i) => i.id === theirItem.id);
    expect(stillTheirs?.ownerId).toBe(OTHER);
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
    // is killed" (rules/README.md:423). dropEquippedItems clears the
    // attachment, so this exercises the real death path rather than a
    // hand-built stale pointer — the item is left for either side to take.
    const bearer = makeUnit({ ownerId: ACTIVE });
    const gear = makeItem({ ownerId: ACTIVE, equippedTo: bearer.id });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(gear);
    });
    expect(controllerAt00(state, gear.id)).toBe(ACTIVE);

    const events: GameEvent[] = [];
    const afterDeath = produce(state, (d) => {
      const cell = d.grid[0][0];
      killUnit(d, cell, cell.units[0], 0, 0, (e) => { events.push(e); });
    });

    expect(afterDeath.grid[0][0].items[0].equippedTo).toBeUndefined();
    expect(controllerAt00(afterDeath, gear.id)).toBeUndefined();
  });

  it("unequipping on the grid drops control entirely", () => {
    const mine = makeUnit({ ownerId: ACTIVE });
    const borne = makeItem({ ownerId: ACTIVE, equippedTo: mine.id });
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
});

// ---------------------------------------------------------------------------
// Listeners and queries under an absent controller
// ---------------------------------------------------------------------------

describe("effects with no controller", () => {
  it("war-banner's equipped buff follows a stolen bearer's side", () => {
    // The equipped half reads ctx.unit.controllerId === controllerId, so it is
    // the sharpest check that the factory received the bearer's side.
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

  it("war-banner's equipped buff stops once the banner is loose", () => {
    // Before #278 the dropped banner kept buffing its last holder's side.
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
  });

  it("rebuildListeners and computeReveals survive a loose copy of every item", () => {
    // A cheap sweep: any ITEM_EFFECTS factory that dereferences its controllerId
    // instead of gating on it throws here rather than in a card-specific test.
    const definitionIds = Object.keys(ITEM_EFFECTS);
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      for (const definitionId of definitionIds) {
        d.grid[0][0].items.push(makeItem({ ownerId: ACTIVE, definitionId }));
        d.players[ACTIVE_IDX].hq.push(makeItem({ ownerId: ACTIVE, definitionId }));
      }
    });

    expect(definitionIds.length).toBeGreaterThan(0);
    expect(() => rebuildListeners(state)).not.toThrow();
    // getVisibleState is the public path into computeReveals, which runs every
    // item factory a second time for its reveals provider.
    expect(() => getVisibleState(state, ACTIVE)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Raze destination (#278 decision) — items to the razer, units to controllers
// ---------------------------------------------------------------------------

describe("raze discards items to the razing player", () => {
  it("a loose item at a razed cell goes to the razer, not its owner", () => {
    // rules/README.md:173 says only that items "are discarded"; this matches
    // mission completion (:370), the other rule for a wiped cell, which routes
    // to the acting player "regardless of original ownership".
    const razer = makeUnit({ ownerId: ACTIVE });
    const theirItem = makeItem({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(razer);
      d.grid[0][0].items.push({ ...theirItem, controllerId: OTHER });
      d.turn.actionPointsRemaining = 5;
    });

    const { state: next } = applyAction(
      state, { type: "raze", playerId: ACTIVE, unitId: razer.id, row: 0, col: 0 },
    );
    const ns = next as MainGameState;

    const activePile = ns.players.find((p) => p.id === ACTIVE)?.discardPile ?? [];
    const otherPile = ns.players.find((p) => p.id === OTHER)?.discardPile ?? [];
    expect(activePile.some((c) => c.id === theirItem.id)).toBe(true);
    expect(otherPile.some((c) => c.id === theirItem.id)).toBe(false);
  });

  it("a razed unit still routes to its own controller", () => {
    // Deliberate asymmetry (#91 decision 4): control of a unit is bought,
    // stolen or won, so a unit goes home to whoever holds it. Nobody earns a
    // loose item. Raze bars enemy units, so the two rules only diverge for a
    // unit the razer controls but does not own — which is this case.
    const razer = makeUnit({ ownerId: ACTIVE });
    const borrowed = makeUnit({ ownerId: OTHER });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(razer, { ...borrowed, controllerId: ACTIVE });
      d.turn.actionPointsRemaining = 5;
    });

    const { state: next } = applyAction(
      state, { type: "raze", playerId: ACTIVE, unitId: razer.id, row: 0, col: 0 },
    );
    const ns = next as MainGameState;

    // Controlled by ACTIVE at the time of the raze, so it lands there — the
    // assertion is about the routing rule, not about ownership.
    const activePile = ns.players.find((p) => p.id === ACTIVE)?.discardPile ?? [];
    expect(activePile.some((c) => c.id === borrowed.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A loose item may be taken, not operated (rules/README.md:419, :428)
// ---------------------------------------------------------------------------

describe("a loose item is exposed for pickup, not for use", () => {
  it("offers equip on an opponent's dropped item, but never activate", () => {
    // The item is the opponent's by every stored measure — ownerId and the
    // stale controllerId both name OTHER — yet a co-located friendly unit may
    // still take it (rules/README.md:419). What it may not do is operate it in
    // place: that right arrives with the pickup (:428). Only the active player
    // is enumerated (valid-actions.ts:44), so ACTIVE's view is the whole test.
    const stone = makeItem({
      ownerId: OTHER,
      definitionId: "philosophers-stone",
      actions: [{ name: "transmute", apCost: 1, effect: "gold[3]" }],
    });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(makeUnit({ ownerId: ACTIVE }), makeUnit({ ownerId: OTHER }));
      d.grid[0][0].items.push({ ...stone, controllerId: OTHER });
    });

    const offered = getValidActions(state, ACTIVE)
      .filter((a) => ("itemId" in a && a.itemId === stone.id)
        || ("cardId" in a && a.cardId === stone.id));
    expect(offered.some((a) => a.type === "equip")).toBe(true);
    expect(offered.some((a) => a.type === "activate")).toBe(false);
  });
});
