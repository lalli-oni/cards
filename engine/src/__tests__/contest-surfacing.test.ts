import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import type {
  CombatSide,
  ContestSide,
  GameEvent,
  MainGameState,
  ModifierEntry,
} from "../types";
import {
  createTestGame,
  makeLocation,
  makePassiveEvent,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 0;
const OTHER_IDX = 1;

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame(), fn);
}

function findPair(events: readonly GameEvent[]): Extract<GameEvent, { type: "combat_pair_resolved" }> {
  const pair = events.find((e) => e.type === "combat_pair_resolved");
  if (!pair || pair.type !== "combat_pair_resolved") {
    throw new Error("expected combat_pair_resolved event in batch");
  }
  return pair;
}

function findContest(events: readonly GameEvent[]): Extract<GameEvent, { type: "contest_resolved" }> {
  const ev = events.find((e) => e.type === "contest_resolved");
  if (!ev || ev.type !== "contest_resolved") {
    throw new Error("expected contest_resolved event in batch");
  }
  return ev;
}

function hasModifierFrom(side: CombatSide | ContestSide, definitionId: string): ModifierEntry | undefined {
  return side.modifiers.find((m) => m.source.definitionId === definitionId);
}

// ---------------------------------------------------------------------------
// combat_pair_resolved
// ---------------------------------------------------------------------------

describe("combat_pair_resolved", () => {
  it("emits per-side breakdown for a vanilla strength contest", () => {
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

    const pair = findPair(events);
    expect(pair.row).toBe(0);
    expect(pair.col).toBe(0);
    expect(pair.attacker.unitId).toBe(attacker.id);
    expect(pair.attacker.baseStrength).toBe(7);
    expect(pair.attacker.modifiers).toEqual([]);
    expect(pair.attacker.roll).toBeGreaterThanOrEqual(1);
    expect(pair.attacker.roll).toBeLessThanOrEqual(6);
    expect(pair.attacker.power).toBe(pair.attacker.baseStrength + pair.attacker.roll);
    expect(pair.attacker.injuredBefore).toBe(false);

    expect(pair.defender.unitId).toBe(defender.id);
    expect(pair.defender.baseStrength).toBe(5);
    expect(pair.defender.modifiers).toEqual([]);
    expect(pair.defender.power).toBe(pair.defender.baseStrength + pair.defender.roll);
    expect(["kill_attacker", "kill_defender", "injure_attacker", "injure_defender", "tie"]).toContain(pair.outcome);
  });

  it("emits the pair event BEFORE unit_injured / unit_killed in the same batch", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 20 });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
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

    const pairIdx = events.findIndex((e) => e.type === "combat_pair_resolved");
    const killIdx = events.findIndex((e) => e.type === "unit_killed");
    expect(pairIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(pairIdx).toBeLessThan(killIdx);
  });

  it("surfaces injury penalty on the injured side as a unit-typed modifier", () => {
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5 });
    const defender = makeUnit({ ownerId: OTHER, strength: 5, injured: true });
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

    const pair = findPair(events);
    expect(pair.defender.injuredBefore).toBe(true);
    const penalty = pair.defender.modifiers.find((m) => m.delta < 0 && m.source.cardId === defender.id);
    expect(penalty).toBeDefined();
    expect(penalty!.delta).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// per-modifier-source coverage in combat
// ---------------------------------------------------------------------------

describe("combat modifier sources", () => {
  it("Arms Race shows up as a passive_event-typed modifier on the warrior", () => {
    const armsRace = {
      ...makePassiveEvent({ ownerId: ACTIVE, definitionId: "arms-race" }),
      remainingDuration: 99,
    };
    const warrior = makeUnit({ ownerId: ACTIVE, strength: 5, attributes: ["Warrior"] });
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].passiveEvents.push(armsRace);
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(warrior, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [warrior.id],
      row: 0,
      col: 0,
    });

    const pair = findPair(events);
    const mod = hasModifierFrom(pair.attacker, "arms-race");
    expect(mod).toBeDefined();
    expect(mod!.delta).toBe(2);
    expect(mod!.source.type).toBe("passive_event");
    expect(mod!.source.cardId).toBe(armsRace.id);
  });

  it("Plague shows up as a passive_event-typed modifier on the defender", () => {
    const targetLoc = makeLocation({ ownerId: ACTIVE, definitionId: "target-loc" });
    const plague = {
      ...makePassiveEvent({ ownerId: OTHER, definitionId: "plague" }),
      remainingDuration: 99,
      targetId: targetLoc.id,
    };
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5 });
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.players[OTHER_IDX].passiveEvents.push(plague);
      d.grid[0][0].location = targetLoc;
      d.grid[0][0].units.push(attacker, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });

    const pair = findPair(events);
    // Plague hits both units on the target tile.
    const atkMod = hasModifierFrom(pair.attacker, "plague");
    const defMod = hasModifierFrom(pair.defender, "plague");
    expect(atkMod).toBeDefined();
    expect(atkMod!.delta).toBe(-2);
    expect(atkMod!.source.type).toBe("passive_event");
    expect(atkMod!.source.cardId).toBe(plague.id);
    expect(defMod).toBeDefined();
    expect(defMod!.source.cardId).toBe(plague.id);
  });

  it("The Forge shows up as a location-typed modifier", () => {
    const forge = makeLocation({ ownerId: ACTIVE, definitionId: "the-forge" });
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5 });
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = forge;
      d.grid[0][0].units.push(attacker, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [attacker.id],
      row: 0,
      col: 0,
    });

    const pair = findPair(events);
    const mod = hasModifierFrom(pair.attacker, "the-forge");
    expect(mod).toBeDefined();
    expect(mod!.delta).toBe(1);
    expect(mod!.source.type).toBe("location");
    expect(mod!.source.cardId).toBe(forge.id);
  });
});

// ---------------------------------------------------------------------------
// buff-verb origin
// ---------------------------------------------------------------------------

describe("buff origin tracking", () => {
  it("a buff applied by another unit carries that unit's cardId as the source", () => {
    const buffer = makeUnit({ ownerId: ACTIVE, definitionId: "test-buffer" });
    const recipient = makeUnit({
      ownerId: ACTIVE,
      strength: 5,
      statModifiers: [{
        stat: "strength",
        delta: 2,
        remainingDuration: 1,
        source: { type: "unit", cardId: buffer.id, definitionId: buffer.definitionId },
      }],
    });
    const defender = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(recipient, defender);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [recipient.id],
      row: 0,
      col: 0,
    });

    const pair = findPair(events);
    const mod = pair.attacker.modifiers.find((m) => m.source.cardId === buffer.id);
    expect(mod).toBeDefined();
    expect(mod!.delta).toBe(2);
    expect(mod!.source.type).toBe("unit");
    expect(mod!.source.definitionId).toBe("test-buffer");
  });
});

// ---------------------------------------------------------------------------
// contest_resolved (DSL)
// ---------------------------------------------------------------------------

describe("contest_resolved per-side breakdown", () => {
  it("emits per-side baseStat, modifiers, roll, power on the DSL contest", () => {
    const cleopatra = makeUnit({
      ownerId: ACTIVE,
      definitionId: "cleopatra",
      name: "Cleopatra",
      charisma: 9,
      actions: [{
        name: "diplomacy",
        apCost: 1,
        effect: "contest.charisma(enemy + adjacent) > control(target)~round",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, charisma: 4 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: OTHER });
      d.grid[0][0].units.push(cleopatra);
      d.grid[0][1].units.push(enemy);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: cleopatra.id,
      actionName: "diplomacy",
      targetId: enemy.id,
    });

    const contest = findContest(events);
    expect(contest.stat).toBe("charisma");
    expect(contest.attackerId).toBe(cleopatra.id);
    expect(contest.defenderId).toBe(enemy.id);

    expect(contest.attacker).toEqual({
      unitId: cleopatra.id,
      baseStat: 9,
      modifiers: [],
      roll: contest.attacker.roll,
      power: 9 + contest.attacker.roll,
    });
    expect(contest.attacker.roll).toBeGreaterThanOrEqual(1);
    expect(contest.attacker.roll).toBeLessThanOrEqual(6);

    expect(contest.defender).toEqual({
      unitId: enemy.id,
      baseStat: 4,
      modifiers: [],
      roll: contest.defender.roll,
      power: 4 + contest.defender.roll,
    });
  });

  it("keeps the flat attackerPower/defenderPower fields for backward compatibility", () => {
    const cleopatra = makeUnit({
      ownerId: ACTIVE,
      definitionId: "cleopatra",
      charisma: 9,
      actions: [{
        name: "diplomacy",
        apCost: 1,
        effect: "contest.charisma(enemy + adjacent) > control(target)~round",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, charisma: 4 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: OTHER });
      d.grid[0][0].units.push(cleopatra);
      d.grid[0][1].units.push(enemy);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: cleopatra.id,
      actionName: "diplomacy",
      targetId: enemy.id,
    });

    const contest = findContest(events);
    expect(contest.attackerPower).toBe(contest.attacker.power);
    expect(contest.defenderPower).toBe(contest.defender.power);
  });

  it("surfaces a buff-verb modifier on the DSL contest payload too", () => {
    const buffer = makeUnit({ ownerId: ACTIVE, definitionId: "test-buffer" });
    const cleopatra = makeUnit({
      ownerId: ACTIVE,
      definitionId: "cleopatra",
      charisma: 9,
      statModifiers: [{
        stat: "charisma",
        delta: 1,
        remainingDuration: 1,
        source: { type: "unit", cardId: buffer.id, definitionId: buffer.definitionId },
      }],
      actions: [{
        name: "diplomacy",
        apCost: 1,
        effect: "contest.charisma(enemy + adjacent) > control(target)~round",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, charisma: 4 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][1].location = makeLocation({ ownerId: OTHER });
      d.grid[0][0].units.push(cleopatra);
      d.grid[0][1].units.push(enemy);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: cleopatra.id,
      actionName: "diplomacy",
      targetId: enemy.id,
    });

    const contest = findContest(events);
    expect(contest.attacker.modifiers).toHaveLength(1);
    expect(contest.attacker.modifiers[0].source.cardId).toBe(buffer.id);
    expect(contest.attacker.modifiers[0].delta).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// unit_buffed source
// ---------------------------------------------------------------------------

describe("unit_buffed source", () => {
  it("carries the acting card identity as a structured ModifierSource", () => {
    const buffer = makeUnit({
      ownerId: ACTIVE,
      definitionId: "test-buffer",
      actions: [{
        name: "boost",
        apCost: 1,
        effect: "buff.strength(friendly + same)[2]~turn",
      }],
    });
    const friend = makeUnit({ ownerId: ACTIVE, strength: 4 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(buffer, friend);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: buffer.id,
      actionName: "boost",
    });

    const buffed = events.find((e) => e.type === "unit_buffed");
    expect(buffed).toBeDefined();
    if (!buffed || buffed.type !== "unit_buffed") return;
    expect(buffed.source).toEqual({
      type: "unit",
      cardId: buffer.id,
      definitionId: "test-buffer",
    });
  });
});
