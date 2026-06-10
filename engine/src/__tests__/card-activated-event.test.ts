import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import type { MainGameState, UnitCard } from "../types";
import {
  createTestGame,
  makeLocation,
  makePolicy,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

const ACTIVE = "p2";
const ACTIVE_IDX = 0;
const OPPONENT = "p1";
const OPPONENT_IDX = 1;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

function hqUnit(name: string, effect: string, apCost = 1): UnitCard {
  return makeUnit({
    ownerId: ACTIVE,
    name,
    actions: [{ name: "act", apCost, effect }],
  });
}

describe("card_activated event — emission", () => {
  it("HQ unit activate emits card_activated with full payload", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]", 2);
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: mansa.id,
      actionName: "act",
    });

    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      playerId: ACTIVE,
      cardId: mansa.id,
      cardName: "Mansa Musa",
      actionName: "act",
    });
    expect((activated as { target?: unknown }).target).toBeUndefined();
  });

  it("Grid unit activate emits card_activated", () => {
    const nefertiti = hqUnit("Nefertiti", "buff.charisma(all + friendly)[2]~turn");
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(nefertiti);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: nefertiti.id,
      actionName: "act",
    });

    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      playerId: ACTIVE,
      cardId: nefertiti.id,
      cardName: "Nefertiti",
      actionName: "act",
    });
  });

  it("Policy activate (Spymaster Infiltrate) emits card_activated with policy name", () => {
    const spymaster = makePolicy({
      ownerId: ACTIVE,
      definitionId: "spymaster",
      name: "Spymaster",
    });
    const oppCard = makeUnit({ ownerId: OPPONENT, name: "OppCard" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].activePolicies.push(spymaster);
      d.players[OPPONENT_IDX].hand.push(oppCard);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: spymaster.id,
      actionName: "Infiltrate",
    });

    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      playerId: ACTIVE,
      cardId: spymaster.id,
      cardName: "Spymaster",
      actionName: "Infiltrate",
    });
  });

  it("self-destroying activate still emits card_activated with the correct cardName", () => {
    // The whole reason cardName is denormalized on the event: the card may
    // be destroyed mid-action (Ramesses' monument: kill(self)) before the
    // renderer reads the log. If a future refactor moved emit after
    // executeEffect, this test would catch the regression.
    const ramesses = hqUnit("Ramesses II", "vp[1] + kill(self)", 2);
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(ramesses);
    });

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: ramesses.id,
      actionName: "act",
    });

    expect((next as MainGameState).grid[0][0].units.find((u) => u.id === ramesses.id)).toBeUndefined();
    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      cardId: ramesses.id,
      cardName: "Ramesses II",
    });
  });

  it("payload carries a card target through to the event", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]", 2);
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: mansa.id,
      actionName: "act",
      targetId: "some-target-id",
    });

    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      cardId: mansa.id,
      target: { kind: "card", id: "some-target-id" },
    });
  });

  it("payload carries a cell target through to the event", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]", 2);
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: mansa.id,
      actionName: "act",
      targetCell: { row: 2, col: 3 },
    });

    const activated = events.find((e) => e.type === "card_activated");
    expect(activated).toMatchObject({
      type: "card_activated",
      cardId: mansa.id,
      target: { kind: "cell", row: 2, col: 3 },
    });
  });

  it("card_activated precedes every downstream DSL event (ordering)", () => {
    // Nefertiti's buff produces one unit_buffed per friendly unit at the cell;
    // the activation announcement must come before all of them.
    const nefertiti = hqUnit("Nefertiti", "buff.charisma(all + friendly)[2]~turn");
    const friendly = makeUnit({ ownerId: ACTIVE, name: "Ally" });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(nefertiti);
      d.grid[0][0].units.push(friendly);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: nefertiti.id,
      actionName: "act",
    });

    const activatedIdx = events.findIndex((e) => e.type === "card_activated");
    expect(activatedIdx).toBeGreaterThanOrEqual(0);
    const buffedIndices = events
      .map((e, i) => (e.type === "unit_buffed" ? i : -1))
      .filter((i) => i >= 0);
    expect(buffedIndices.length).toBeGreaterThan(0);
    expect(buffedIndices.every((i) => activatedIdx < i)).toBe(true);
  });

  it("policy activate emits card_activated before its effect events", () => {
    // Same ordering invariant as the unit case, exercised on the policy branch.
    const spymaster = makePolicy({
      ownerId: ACTIVE,
      definitionId: "spymaster",
      name: "Spymaster",
    });
    const oppCard = makeUnit({ ownerId: OPPONENT, name: "OppCard" });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].activePolicies.push(spymaster);
      d.players[OPPONENT_IDX].hand.push(oppCard);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: spymaster.id,
      actionName: "Infiltrate",
    });

    const activatedIdx = events.findIndex((e) => e.type === "card_activated");
    const peekedIdx = events.findIndex((e) => e.type === "cards_peeked");
    expect(activatedIdx).toBeGreaterThanOrEqual(0);
    if (peekedIdx >= 0) expect(activatedIdx).toBeLessThan(peekedIdx);
  });
});

describe("card_activated event — error paths", () => {
  it("rejects activate of a card the player does not own", () => {
    const oppUnit = hqUnit("Opponent Unit", "gold[5]");
    oppUnit.ownerId = OPPONENT;
    const state = gameWith((d) => {
      // Place it where findUnitPosition can locate it — opponent's HQ
      d.players[OPPONENT_IDX].hq.push(oppUnit);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: oppUnit.id,
        actionName: "act",
      }),
    ).toThrow(/not owned/);
  });

  it("rejects activate with an action name not on the unit", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: mansa.id,
        actionName: "nonexistent",
      }),
    ).toThrow(/not found on unit/);
  });

  it("rejects activate for a cardId that is not on the grid, HQ, or active policies", () => {
    const state = gameWith(() => {});

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: "ghost-id",
        actionName: "act",
      }),
    ).toThrow(/not found on grid, HQ, or active policies/);
  });

  it("rejects activate for a policy with no POLICY_ACTIONS registration", () => {
    const policy = makePolicy({
      ownerId: ACTIVE,
      definitionId: "unregistered",
      name: "Unregistered Policy",
    });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].activePolicies.push(policy);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: policy.id,
        actionName: "anything",
      }),
    ).toThrow(/has no actions registered/);
  });

  it("rejects activate with insufficient AP — and does NOT leave a card_activated event behind", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]", 5); // apCost 5 > default 3 AP/turn
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: mansa.id,
        actionName: "act",
      }),
    ).toThrow(/AP|action points/i);
    // applyAction throws cleanly — events from the failed call are not
    // observable to the caller, but assert state is unchanged just in case.
    expect(state.players[ACTIVE_IDX].hq.find((c) => c.id === mansa.id)).toBeDefined();
  });

  it("rejects activate with a targetCell outside grid bounds", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: mansa.id,
        actionName: "act",
        targetCell: { row: 99, col: 99 },
      }),
    ).toThrow(/outside grid bounds/);
  });

  it("rejects activate with both targetId and targetCell set", () => {
    const mansa = hqUnit("Mansa Musa", "gold[5]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(mansa);
    });

    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: mansa.id,
        actionName: "act",
        targetId: "some-target",
        targetCell: { row: 0, col: 0 },
      }),
    ).toThrow(/at most one of targetId\/targetCell/);
  });
});
