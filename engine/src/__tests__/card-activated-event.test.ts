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
    expect(activated).toEqual({
      type: "card_activated",
      playerId: ACTIVE,
      cardId: mansa.id,
      cardName: "Mansa Musa",
      actionName: "act",
      targetId: undefined,
      targetCell: undefined,
    });
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

  it("payload carries targetId through to the event", () => {
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
      targetId: "some-target-id",
    });
  });

  it("payload carries targetCell through to the event", () => {
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
      targetCell: { row: 2, col: 3 },
    });
  });

  it("card_activated precedes downstream DSL events (ordering)", () => {
    // Nefertiti's buff emits one unit_buffed per friendly unit at her cell.
    // The activation announcement must appear in the log before those.
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
    const buffedIdx = events.findIndex((e) => e.type === "unit_buffed");
    expect(activatedIdx).toBeGreaterThanOrEqual(0);
    expect(buffedIdx).toBeGreaterThanOrEqual(0);
    expect(activatedIdx).toBeLessThan(buffedIdx);
  });
});
