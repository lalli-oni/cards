/**
 * Acceptance tests for the ownerId / controllerId split (#91).
 *
 * Encoded BEFORE the reader/writer sweeps so they double as the spec.
 * Each test pins one piece of behavior the new model has to produce:
 *
 *   - handleBuy makes the buyer the controller
 *   - handleSeedSteal makes the thief the controller (ownerId untouched)
 *   - bought units are activatable by the buyer end-to-end
 *   - execControl writes controllerId (not ownerId) and captures the
 *     pre-cast controller, so expiry reverts to wherever control last lived
 *     — handles seed-steal-then-control and the nested-control edge cases
 *   - killed units route to the current controller's discard pile, not
 *     the original owner's
 *   - passive-event factories tied to a player (e.g. golden-age) fire for
 *     whoever currently controls the card, so a bought passive benefits
 *     the buyer
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { produce, type Draft } from "immer";
import { applyAction } from "../apply-action";
import { fillAction } from "../action-helpers";
import { rebuildListeners } from "../listeners/rebuild";
import { fromState } from "../rng";
import { executeEffect, type ExecutionContext } from "../effect-dsl/executor";
import { killUnit } from "../unit-helpers";
import { getActivePlayerId, type GameEvent, type GameState, type MainGameState, type SeedingAction, type SeedingGameState } from "../types";
import { getValidActions } from "../valid-actions";
import {
  createSeedingGame,
  createTestGame,
  makeLocation,
  makePassiveEvent,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

// SEED="test-seed" puts p2 first. Match the convention used by main-actions.test.ts.
const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 0;
const OTHER_IDX = 1;

function gameWith(fn: (draft: Draft<MainGameState>) => void): MainGameState {
  return produce(createTestGame(), fn);
}

/** Run a DSL effect against a state for a chosen controlling player. */
function runEffect(
  state: MainGameState,
  effectStr: string,
  asPlayerId: string,
  opts?: { targetId?: string },
): { state: MainGameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const { queries } = rebuildListeners(state);
  const nextState = produce(state, (draft) => {
    const rng = fromState(draft.rngState);
    const ctx: ExecutionContext = {
      draft,
      playerId: asPlayerId,
      actingCardSource: { type: "unit", cardId: "test-actor", definitionId: "test-actor" },
      emit: (e) => { events.push(e); },
      events,
      queries,
      rng,
      targetId: opts?.targetId,
    };
    const result = executeEffect(effectStr, ctx);
    draft.rngState = (result.rng.getState?.() ?? draft.rngState) as number[];
  });
  return { state: nextState, events };
}

// ---------------------------------------------------------------------------
// Buy → controllerId becomes buyer; ownerId stays at provenance value
// ---------------------------------------------------------------------------

describe("buy and controllerId", () => {
  it("sets controllerId to the buyer while preserving ownerId", () => {
    const marketCard = makeUnit({ ownerId: "neutral", cost: "2" });
    const state = gameWith((d) => {
      d.market.push(marketCard);
      d.players[ACTIVE_IDX].gold = 10;
    });

    const { state: next } = applyAction(state, {
      type: "buy",
      playerId: ACTIVE,
      cardId: marketCard.id,
    });
    const ns = next as MainGameState;
    const bought = ns.players[ACTIVE_IDX].hand.find((c) => c.id === marketCard.id);

    expect(bought).toBeDefined();
    expect(bought!.controllerId).toBe(ACTIVE);
    // Provenance preserved — useful for end-of-game return mechanics later.
    expect(bought!.ownerId).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// Spartacus repro — bought unit is fully usable by the buyer
// ---------------------------------------------------------------------------

describe("Spartacus repro: bought unit is the buyer's", () => {
  it("buy → deploy → enter → buyer's getValidActions sees the unit", () => {
    const spartacus = makeUnit({
      ownerId: "neutral",
      cost: "0",
      name: "Spartacus",
      actions: [{ name: "rally", apCost: 1, effect: "gold[1]" }],
    });
    const perimeter = makeLocation({ ownerId: ACTIVE });

    const setup = gameWith((d) => {
      d.market.push(spartacus);
      d.grid[0][0].location = perimeter;
    });

    const { state: afterBuy } = applyAction(setup, {
      type: "buy",
      playerId: ACTIVE,
      cardId: spartacus.id,
    });

    const { state: afterDeploy } = applyAction(afterBuy as MainGameState, {
      type: "deploy",
      playerId: ACTIVE,
      cardId: spartacus.id,
    });

    const { state: afterEnter } = applyAction(afterDeploy as MainGameState, {
      type: "enter",
      playerId: ACTIVE,
      unitId: spartacus.id,
      row: 0,
      col: 0,
    });
    const ns = afterEnter as MainGameState;

    const placed = ns.grid[0][0].units.find((u) => u.id === spartacus.id);
    expect(placed, "Spartacus must land on the buyer's grid").toBeDefined();
    expect(placed!.controllerId).toBe(ACTIVE);

    const buyerActions = getValidActions(ns, ACTIVE);
    const buyerCanActivate = buyerActions.some(
      (a) => a.type === "activate" && a.cardId === spartacus.id,
    );
    expect(buyerCanActivate, "buyer must be able to activate the unit").toBe(true);

    const otherActions = getValidActions(ns, OTHER);
    const otherCanActivate = otherActions.some(
      (a) => a.type === "activate" && a.cardId === spartacus.id,
    );
    expect(otherCanActivate, "non-controller must not see this unit's actions").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seed-steal → controllerId becomes the thief; ownerId preserved
// ---------------------------------------------------------------------------

describe("seed_steal and controllerId", () => {
  /** Advance a seeding game to the seed_steal step using default action picks. */
  function driveToSeedSteal(): SeedingGameState {
    let state: GameState = createSeedingGame({ deckSize: 20 });
    // Walk through seed_draw and seed_keep for each player.
    const drive = (s: GameState): GameState => {
      const id = getActivePlayerId(s);
      const actions = getValidActions(s, id) as SeedingAction[];
      const template = actions[0];
      const action = fillAction(s, template) as SeedingAction;
      return applyAction(s, action).state;
    };
    while (
      state.phase === "seeding" &&
      (state as SeedingGameState).seedingState.step !== "seed_steal"
    ) {
      state = drive(state);
    }
    if (state.phase !== "seeding") {
      throw new Error("Expected to land on seed_steal step, but phase changed");
    }
    return state as SeedingGameState;
  }

  it("transfers control to the thief without mutating provenance", () => {
    const state = driveToSeedSteal();
    const thiefId = state.seedingState.currentPlayerId;
    // Find a card in the middle area drafted by someone other than the thief
    // — that's the one whose `ownerId` differs from the new controller.
    const targetCard = state.seedingState.middleArea.find(
      (c) => c.ownerId !== thiefId && c.type !== "location",
    );
    if (!targetCard) {
      // With two players and a 20-card alternating deck, this should be
      // unreachable; fail loudly rather than silently skip.
      throw new Error("Test setup: no non-location card to steal from a different drafter");
    }
    const originalOwner = targetCard.ownerId;

    const { state: next } = applyAction(state, {
      type: "seed_steal",
      playerId: thiefId,
      cardId: targetCard.id,
    } as SeedingAction);

    const ns = next as SeedingGameState;
    const thief = ns.players.find((p) => p.id === thiefId)!;
    // The card lands in either the thief's market deck or prospect deck
    // depending on type; just check across both for robustness.
    const stolenInDeck =
      thief.marketDeck.find((c) => c.id === targetCard.id) ??
      thief.prospectDeck.find((c) => c.id === targetCard.id);
    expect(stolenInDeck, "stolen card must land in thief's deck").toBeDefined();
    expect(stolenInDeck!.controllerId).toBe(thiefId);
    expect(stolenInDeck!.ownerId).toBe(originalOwner);
  });
});

// ---------------------------------------------------------------------------
// execControl writes controllerId, captures pre-cast controller, reverts on expiry
// ---------------------------------------------------------------------------

describe("execControl and controllerId", () => {
  it("control writes controllerId (not ownerId) and captures the pre-cast controller", () => {
    const enemy = makeUnit({ ownerId: OTHER });
    const myUnit = makeUnit({ ownerId: ACTIVE });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(enemy, myUnit);
    });

    const { state: next } = runEffect(state, "control(enemy)~turn", ACTIVE, {
      targetId: enemy.id,
    });
    const ns = next;
    const controlled = ns.grid[0][0].units.find((u) => u.id === enemy.id)!;

    expect(controlled.controllerId).toBe(ACTIVE);
    // Provenance preserved — the enemy card was seeded by OTHER and stays so.
    expect(controlled.ownerId).toBe(OTHER);
    // Pre-cast controller captured for revert (OTHER controlled it before).
    expect(controlled.controlOverride?.previousControllerId).toBe(OTHER);
  });

  it("expiry reverts controllerId to the previous controller, not the original drafter", () => {
    // Scenario: P1 seeded the card, P2 stole it during seeding (so
    // controllerId = P2, ownerId = P1). Then P1 casts a control spell.
    // After the spell expires, control must return to P2 (the thief), not
    // to P1 (the spell caster) and not to P1 (the original drafter).
    const stolenUnit = makeUnit({
      ownerId: OTHER,        // original drafter
      controllerId: ACTIVE,  // thief — modeled by direct setup
    });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(stolenUnit);
    });

    // OTHER (drafter) casts control on the stolen unit for one turn.
    const { state: afterCast } = runEffect(state, "control(enemy)~turn", OTHER, {
      targetId: stolenUnit.id,
    });
    let unitAfterCast = afterCast.grid[0][0].units.find((u) => u.id === stolenUnit.id)!;
    expect(unitAfterCast.controllerId).toBe(OTHER);
    expect(unitAfterCast.controlOverride?.previousControllerId).toBe(ACTIVE);

    // Run end-of-turn to drain the override duration.
    const { state: afterEndTurn } = applyAction(afterCast, {
      type: "pass",
      playerId: ACTIVE,
    });
    const ns = afterEndTurn as MainGameState;
    const reverted = ns.grid[0][0].units.find((u) => u.id === stolenUnit.id)!;
    expect(reverted.controllerId, "controllerId reverts to the thief").toBe(ACTIVE);
    expect(reverted.ownerId, "ownerId stays with the original drafter").toBe(OTHER);
    expect(reverted.controlOverride).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Discard on death → controller's pile
// ---------------------------------------------------------------------------

describe("kill and discard destination", () => {
  it("killed controlled unit lands in the controller's discard, not the owner's", () => {
    const enemy = makeUnit({
      ownerId: OTHER,        // original owner
      controllerId: ACTIVE,  // currently controlled by ACTIVE
    });
    const location = makeLocation({ ownerId: ACTIVE });
    const state = gameWith((d) => {
      d.grid[0][0].location = location;
      d.grid[0][0].units.push(enemy);
    });

    const events: GameEvent[] = [];
    const killed = produce(state, (d) => {
      const cell = d.grid[0][0];
      const unit = cell.units.find((u) => u.id === enemy.id)!;
      killUnit(d, cell, unit, 0, 0, (e) => events.push(e));
    });

    expect(killed.players[ACTIVE_IDX].discardPile.some((c) => c.id === enemy.id))
      .toBe(true);
    expect(killed.players[OTHER_IDX].discardPile.some((c) => c.id === enemy.id))
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Passive-event listeners fire for the controller, not the original owner
// ---------------------------------------------------------------------------

describe("passive event listeners follow controllerId", () => {
  it("golden-age bought by opponent fires on the buyer's turn, not the seller's", () => {
    // Construct a state where golden-age has been "bought" by ACTIVE:
    // ownerId remains OTHER (the seller), controllerId is ACTIVE.
    const goldenAge = makePassiveEvent({
      ownerId: OTHER,
      controllerId: ACTIVE,
      definitionId: "golden-age",
      duration: 99,
    });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].passiveEvents.push({
        ...goldenAge,
        remainingDuration: 99,
      });
    });

    // Walk through a full round so each player's turn_started fires once.
    // Assert on emitted gold_changed events whose `reason === "golden-age"`,
    // which isolates the listener from runStartOfTurn's `turn_income` event.
    const { events: passEvents1 } = applyAction(state, { type: "pass", playerId: ACTIVE });
    const t1 = applyAction(state, { type: "pass", playerId: ACTIVE }).state;
    const { events: passEvents2 } = applyAction(t1 as MainGameState, { type: "pass", playerId: OTHER });
    const allEvents = [...passEvents1, ...passEvents2];

    const goldenAgeFor = (pid: string): number =>
      allEvents.filter(
        (e) => e.type === "gold_changed"
          && "reason" in e && e.reason === "golden-age"
          && "playerId" in e && e.playerId === pid,
      ).length;

    expect(goldenAgeFor(ACTIVE), "controller receives the bonus").toBeGreaterThanOrEqual(1);
    expect(goldenAgeFor(OTHER), "original owner does not receive the bonus").toBe(0);
  });
});
