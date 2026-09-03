import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import type { ItemCard, MainAction, MainGameState, UnitCard } from "../types";
import { createTestGame, makeItem, makeLocation, makeUnit, resetIds } from "./helpers";

beforeEach(() => resetIds());

// Same active-player assumption as activate-hq.test.ts — the SEED shuffle puts
// p2 first, so player index 0 is the active player after createTestGame().
const ACTIVE = "p2";
const ACTIVE_IDX = 0;
const OPPONENT = "p1";

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

/** An item carrying a single activatable action (Philosopher's Stone shape). */
function actionItem(name: string, effect: string, apCost = 1, owner: string = ACTIVE): ItemCard {
  return makeItem({
    ownerId: owner,
    name,
    definitionId: "philosophers-stone",
    actions: [{ name: "transmute", apCost, effect }],
  });
}

type ActivateAction = Extract<MainAction, { type: "activate" }>;

function activatesFor(state: MainGameState, cardId: string): ActivateAction[] {
  return getValidActions(state, ACTIVE).filter(
    (a): a is ActivateAction => a.type === "activate" && a.cardId === cardId,
  );
}

describe("item activate — enumeration (#130)", () => {
  it("HQ item offers its action when a controlling unit is co-located", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(makeUnit({ ownerId: ACTIVE, name: "Guard" }));
      d.players[ACTIVE_IDX].hq.push(stone);
    });
    expect(activatesFor(state, stone.id)).toHaveLength(1);
  });

  it("HQ item offers nothing when no unit is present to operate it", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(stone); // item alone, no unit
    });
    expect(activatesFor(state, stone.id)).toHaveLength(0);
  });

  it("grid item equipped to a unit is activatable (the bearer satisfies the co-located gate)", () => {
    // There is no equip-specific activation path — an equipped item is activatable
    // because its bearer is, by construction, a friendly unit in the item's cell,
    // which is exactly the generic hasControllingUnitAt gate. `equippedTo` is set
    // to model a realistic bearer scenario, not because equip is checked directly.
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      const unit = makeUnit({ ownerId: ACTIVE, name: "Bearer" });
      stone.equippedTo = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(stone);
    });
    expect(activatesFor(state, stone.id)).toHaveLength(1);
  });

  it("enumerates every action of a multi-action item independently", () => {
    const relic = makeItem({
      ownerId: ACTIVE,
      name: "Alchemist's Relic",
      definitionId: "philosophers-stone",
      actions: [
        { name: "transmute", apCost: 1, effect: "gold[3]" },
        { name: "brew", apCost: 1, effect: "gold[5]" },
      ],
    });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(makeUnit({ ownerId: ACTIVE, name: "Guard" }));
      d.players[ACTIVE_IDX].hq.push(relic);
    });
    const names = activatesFor(state, relic.id).map((a) => a.actionName).sort();
    expect(names).toEqual(["brew", "transmute"]);
  });

  it("a loose grid item is activatable by nobody until someone equips it", () => {
    // Taking a stored item is what makes it yours (rules/README.md → Items),
    // so a co-located unit gets a pickup right, not a licence to operate the
    // item where it lies. Before #278 the item's own controllerId answered
    // this and a friendly unit in the cell was enough; now a loose item has no
    // controller, so the offer is absent — activatesFor only checks ACTIVE, so
    // this pins ACTIVE's own view, not "both players" (an enemy's view is
    // separately absent, but for the ordinary reason it's never their turn).
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const operator = makeUnit({ ownerId: ACTIVE, name: "Operator" });
    const loose = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(operator);
      d.grid[0][0].items.push(stone);
    });
    expect(activatesFor(loose, stone.id)).toHaveLength(0);

    // Equipping it to that same unit is the whole difference — control now
    // comes from the bearer.
    const { state: taken } = applyAction(
      loose, { type: "equip", playerId: ACTIVE, itemId: stone.id, unitId: operator.id },
    );
    expect(activatesFor(taken as MainGameState, stone.id)).toHaveLength(1);
  });

  it("an enemy unit alone does not satisfy the co-located gate for an HQ item", () => {
    // A grid item can only have a controller by being equipped to a unit in
    // its own cell, whose controller then satisfies hasControllingUnitAt by
    // construction — so on the grid this case is now indistinguishable from
    // "loose item, no controller at all" and is covered by the loose test
    // above. HQ is where the co-located gate is still a live, separate check:
    // an unattached HQ item does have a controller (its own player), so an
    // enemy unit present without a friendly one is what isolates the gate.
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(stone);
      d.players[ACTIVE_IDX].hq.push({ ...makeUnit({ ownerId: OPPONENT, name: "Enemy" }), controllerId: OPPONENT });
    });
    expect(activatesFor(state, stone.id)).toHaveLength(0);
  });

  it("an enemy's borne item is not enumerated even with a friendly unit present", () => {
    // Borne by an opposing unit, so the derived controller is the opponent.
    // (The loose counterpart is covered above: it is offered to nobody at all.)
    const enemyBearer = makeUnit({ ownerId: OPPONENT, name: "Their Bearer" });
    const enemyStone = actionItem("Philosopher's Stone", "gold[3]", 1, OPPONENT);
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(makeUnit({ ownerId: ACTIVE, name: "Operator" }), enemyBearer);
      d.grid[0][0].items.push({ ...enemyStone, equippedTo: enemyBearer.id });
    });
    expect(activatesFor(state, enemyStone.id)).toHaveLength(0);
  });

  it("does not offer the action when AP is below the action cost", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]", 2);
    const state = gameWith((d) => {
      d.turn.actionPointsRemaining = 1;
      d.players[ACTIVE_IDX].hq.push(makeUnit({ ownerId: ACTIVE, name: "Guard" }));
      d.players[ACTIVE_IDX].hq.push(stone);
    });
    expect(activatesFor(state, stone.id)).toHaveLength(0);
  });
});

describe("item activate — application (#130)", () => {
  it("HQ Philosopher's Stone applies its effect and emits card_activated", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(makeUnit({ ownerId: ACTIVE, name: "Guard" }));
      d.players[ACTIVE_IDX].hq.push(stone);
    });
    const goldBefore = state.players[ACTIVE_IDX].gold;
    const apBefore = state.turn.actionPointsRemaining;

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: stone.id,
      actionName: "transmute",
    });

    expect((next as MainGameState).players[ACTIVE_IDX].gold).toBe(goldBefore + 3);
    // AP is spent by the activation (apCost 1) — the deduction, not just the gate.
    expect((next as MainGameState).turn.actionPointsRemaining).toBe(apBefore - 1);
    expect(events.find((e) => e.type === "card_activated")).toMatchObject({
      type: "card_activated",
      playerId: ACTIVE,
      cardId: stone.id,
      cardName: "Philosopher's Stone",
      actionName: "transmute",
      target: undefined,
    });
  });

  it("equipped grid item applies its effect", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      const unit = makeUnit({ ownerId: ACTIVE, name: "Bearer" });
      stone.equippedTo = unit.id;
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(stone);
    });
    const goldBefore = state.players[ACTIVE_IDX].gold;

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: stone.id,
      actionName: "transmute",
    });
    expect((next as MainGameState).players[ACTIVE_IDX].gold).toBe(goldBefore + 3);
  });

  it("a positional-effect item resolves its own grid cell (Siege-Engine-style effect)", () => {
    // The item name is cosmetic; what matters is the positional effect shape:
    // buff.strength(all + friendly) carries no targetId, so execution routes
    // through getActingPosition — the item-grid fallback added for #130. The
    // friendly unit in the item's cell is buffed; one in another cell is not.
    const engine = actionItem("Siege Engine", "buff.strength(all + friendly)[2]~turn");
    const nearUnit = makeUnit({ ownerId: ACTIVE, name: "Near" });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[1][1].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(nearUnit);
      d.grid[1][1].units.push(makeUnit({ ownerId: ACTIVE, name: "Far" }));
      // Borne, not loose: since #278 a loose item has no controller and so no
      // player may activate it. The bearer stands in the item's own cell, which
      // is what getActingPosition resolves.
      d.grid[0][0].items.push({ ...engine, equippedTo: nearUnit.id });
    });

    const { state: next } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: engine.id,
      actionName: "transmute",
    });
    const ns = next as MainGameState;
    const near = ns.grid[0][0].units.find((u) => u.name === "Near") as UnitCard;
    const far = ns.grid[1][1].units.find((u) => u.name === "Far") as UnitCard;
    const nearMod = near.statModifiers?.find((m) => m.stat === "strength" && m.delta === 2);
    expect(nearMod).toBeDefined();
    // The modifier's source carries the acting item's identity (actingCardSource).
    expect(nearMod?.source).toMatchObject({ type: "item", cardId: engine.id });
    expect(far.statModifiers ?? []).toHaveLength(0);
  });

  it("rejects activating an item with no co-located controlling unit", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(stone); // no unit in HQ
    });
    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: stone.id,
        actionName: "transmute",
      }),
    ).toThrow(/no controlling unit co-located/);
  });

  it("rejects activating an item the player does not control", () => {
    const enemyBearer = makeUnit({ ownerId: OPPONENT, name: "Their Bearer" });
    const enemyStone = actionItem("Philosopher's Stone", "gold[3]", 1, OPPONENT);
    const state = gameWith((d) => {
      // A friendly unit is present, so the co-located gate would pass — the
      // control check must reject first. The item is borne by an opposing unit,
      // which is what gives it a controller to differ from ACTIVE; a loose item
      // would reject here too, but for want of any controller at all.
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(makeUnit({ ownerId: ACTIVE, name: "Operator" }), enemyBearer);
      d.grid[0][0].items.push({ ...enemyStone, equippedTo: enemyBearer.id });
    });
    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: enemyStone.id,
        actionName: "transmute",
      }),
    ).toThrow(/is controlled by/);
  });

  it("rejects an item activation naming an action the item does not have", () => {
    const stone = actionItem("Philosopher's Stone", "gold[3]");
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hq.push(makeUnit({ ownerId: ACTIVE, name: "Guard" }));
      d.players[ACTIVE_IDX].hq.push(stone);
    });
    expect(() =>
      applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: stone.id,
        actionName: "nonexistent",
      }),
    ).toThrow(/not found on item/);
  });
});
