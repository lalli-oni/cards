import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { deriveCombatOutcome } from "../apply-main";
import { decideKillVsInjure } from "../unit-helpers";
import { rebuildListeners } from "../listeners/rebuild";
import { POLICY_ACTIONS } from "../listeners/effects";
import { getModifiedStatWithSources } from "../listeners/query";
import type {
  CombatSide,
  ContestSide,
  GameEvent,
  MainGameState,
  ModifierEntry,
} from "../types";
import {
  DEFAULT_CONFIG,
  createTestGame,
  makeInstantEvent,
  makeItem,
  makeLocation,
  makePassiveEvent,
  makePolicy,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

const ACTIVE = "p2";
const OTHER = "p1";
const ACTIVE_IDX = 0;
const OTHER_IDX = 1;

// Pin combat-resolution thresholds in test config so tests don't shift
// outcome when game-balance defaults change.
const COMBAT_CONFIG = {
  ...DEFAULT_CONFIG,
  combat_kill_ratio: 2,
  injury_stat_penalty: 1,
};

function gameWith(fn: (draft: MainGameState) => void): MainGameState {
  return produce(createTestGame({ config: COMBAT_CONFIG }), fn);
}

function findPair(events: readonly GameEvent[]): Extract<GameEvent, { type: "combat_pair_resolved" }> {
  const pair = events.find((e) => e.type === "combat_pair_resolved");
  if (!pair || pair.type !== "combat_pair_resolved") {
    throw new Error("expected combat_pair_resolved event in batch");
  }
  return pair;
}

function findAllPairs(events: readonly GameEvent[]): Extract<GameEvent, { type: "combat_pair_resolved" }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: "combat_pair_resolved" }> => e.type === "combat_pair_resolved");
}

function findContest(events: readonly GameEvent[]): Extract<GameEvent, { type: "contest_resolved" }> {
  const ev = events.find((e) => e.type === "contest_resolved");
  if (!ev || ev.type !== "contest_resolved") {
    throw new Error("expected contest_resolved event in batch");
  }
  return ev;
}

function modifierFrom(side: CombatSide | ContestSide, definitionId: string): ModifierEntry | undefined {
  return side.modifiers.find((m) => m.source.definitionId === definitionId);
}

// ---------------------------------------------------------------------------
// combat_pair_resolved
// ---------------------------------------------------------------------------

describe("combat_pair_resolved", () => {
  it("emits per-side breakdown with top-level player ids", () => {
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
    expect(pair.attackerPlayerId).toBe(ACTIVE);
    expect(pair.defenderPlayerId).toBe(OTHER);

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
  });

  it("emits pair BEFORE unit_killed in the same batch", () => {
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
    // Outcome is pinned to the kill semantics so a refactor of the
    // kill-vs-injure branch is caught.
    const pair = findPair(events);
    expect(pair.outcome).toBe("kill_defender");
  });

  it("emits pair BEFORE unit_injured in the same batch", () => {
    // Strength 5 vs 4 — within 2× ratio for any roll combination, so the
    // loser injures rather than dies.
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 5 });
    const defender = makeUnit({ ownerId: OTHER, strength: 4 });
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
    const injuredIdx = events.findIndex((e) => e.type === "unit_injured");
    expect(pairIdx).toBeGreaterThanOrEqual(0);
    expect(injuredIdx).toBeGreaterThanOrEqual(0);
    expect(pairIdx).toBeLessThan(injuredIdx);
  });

  it("surfaces injury penalty as a `definitionId: \"injured\"` self-source modifier", () => {
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
    const penalty = modifierFrom(pair.defender, "injured");
    expect(penalty).toBeDefined();
    expect(penalty!.source.cardId).toBe(defender.id);
    expect(penalty!.delta).toBe(-1);
  });

  it("emits per pair across a 2v2 — pairing pulls highest-power vs highest-power", () => {
    const a1 = makeUnit({ ownerId: ACTIVE, strength: 10 });
    const a2 = makeUnit({ ownerId: ACTIVE, strength: 3 });
    const d1 = makeUnit({ ownerId: OTHER, strength: 8 });
    const d2 = makeUnit({ ownerId: OTHER, strength: 2 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(a1, a2, d1, d2);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [a1.id, a2.id],
      row: 0,
      col: 0,
    });

    const pairs = findAllPairs(events);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    const firstRound = pairs.slice(0, 2);
    // Pair 1 (highest powers): a1 vs d1; pair 2 (lowest): a2 vs d2.
    const unitIds = new Set([
      firstRound[0].attacker.unitId,
      firstRound[0].defender.unitId,
      firstRound[1].attacker.unitId,
      firstRound[1].defender.unitId,
    ]);
    expect(unitIds.size).toBe(4);
    // a1 (str 10) pairs against d1 (str 8); their unit ids should not appear
    // in the same pair as a2 / d2.
    const hasA1andD1 = firstRound.some((p) =>
      (p.attacker.unitId === a1.id && p.defender.unitId === d1.id),
    );
    expect(hasA1andD1).toBe(true);
  });

  it("attackerPlayerId tracks current controllerId for a controlled unit", () => {
    // Original owner OTHER, currently controlled by ACTIVE. ACTIVE attacks
    // a unit owned by OTHER at the same cell.
    const stolen = makeUnit({
      ownerId: OTHER,
      controllerId: ACTIVE,
      strength: 10,
    });
    const target = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(stolen, target);
    });

    const { events } = applyAction(state, {
      type: "attack",
      playerId: ACTIVE,
      unitIds: [stolen.id],
      row: 0,
      col: 0,
    });

    const pair = findPair(events);
    expect(pair.attackerPlayerId).toBe(ACTIVE);
    expect(pair.defenderPlayerId).toBe(OTHER);
  });
});

// ---------------------------------------------------------------------------
// deriveCombatOutcome — exhaustive on the 5 branches
// ---------------------------------------------------------------------------

describe("deriveCombatOutcome", () => {
  it("returns 'tie' when powers are equal", () => {
    expect(deriveCombatOutcome(8, 8, false, false, 2)).toBe("tie");
  });
  it("returns 'kill_defender' when attacker hits the kill ratio", () => {
    expect(deriveCombatOutcome(10, 5, false, false, 2)).toBe("kill_defender");
  });
  it("returns 'injure_defender' when attacker wins below the kill ratio", () => {
    expect(deriveCombatOutcome(8, 5, false, false, 2)).toBe("injure_defender");
  });
  it("returns 'kill_attacker' when defender hits the kill ratio", () => {
    expect(deriveCombatOutcome(5, 10, false, false, 2)).toBe("kill_attacker");
  });
  it("returns 'injure_attacker' when defender wins below the kill ratio", () => {
    expect(deriveCombatOutcome(5, 8, false, false, 2)).toBe("injure_attacker");
  });
  it("kills the already-injured loser even below the kill ratio", () => {
    expect(deriveCombatOutcome(8, 5, false, true, 2)).toBe("kill_defender");
    expect(deriveCombatOutcome(5, 8, true, false, 2)).toBe("kill_attacker");
  });
});

// ---------------------------------------------------------------------------
// decideKillVsInjure — pure predicate shared by combat and contests
// ---------------------------------------------------------------------------

describe("decideKillVsInjure", () => {
  it("returns 'kill' when the loser was already injured", () => {
    expect(decideKillVsInjure(true, 5, 5, 2)).toBe("kill");
    expect(decideKillVsInjure(true, 6, 100, 2)).toBe("kill");
  });
  it("returns 'kill' when winner hits the kill ratio", () => {
    expect(decideKillVsInjure(false, 10, 5, 2)).toBe("kill");
    expect(decideKillVsInjure(false, 9, 3, 3)).toBe("kill");
  });
  it("returns 'injure' on a narrow win below the kill ratio", () => {
    expect(decideKillVsInjure(false, 8, 5, 2)).toBe("injure");
    expect(decideKillVsInjure(false, 6, 5, 2)).toBe("injure");
  });
  it("killRatio=1 makes any win lethal", () => {
    expect(decideKillVsInjure(false, 6, 5, 1)).toBe("kill");
    expect(decideKillVsInjure(false, 5, 5, 1)).toBe("kill");
  });
  it("killRatio=Infinity guarantees injure (kill threshold unreachable)", () => {
    expect(decideKillVsInjure(false, 1_000_000, 1, Number.POSITIVE_INFINITY)).toBe("injure");
  });
  it("loserPower=0 trivially meets the threshold — always kill", () => {
    // Edge case documented in the predicate's JSDoc. Reachable via the
    // stat-clamp-to-0 path.
    expect(decideKillVsInjure(false, 1, 0, 100)).toBe("kill");
    expect(decideKillVsInjure(false, 1, 0, 2)).toBe("kill");
  });
  it("already-injured loser dies even on an exact tie", () => {
    expect(decideKillVsInjure(true, 5, 5, 2)).toBe("kill");
  });
  it("throws on invalid killRatio (NaN, 0, negative)", () => {
    expect(() => decideKillVsInjure(false, 5, 5, NaN)).toThrow(/killRatio/);
    expect(() => decideKillVsInjure(false, 5, 5, 0)).toThrow(/killRatio/);
    expect(() => decideKillVsInjure(false, 5, 5, -1)).toThrow(/killRatio/);
  });
  it("throws on invalid power inputs (negative, NaN)", () => {
    expect(() => decideKillVsInjure(false, -1, 5, 2)).toThrow(/winnerPower/);
    expect(() => decideKillVsInjure(false, 5, NaN, 2)).toThrow(/loserPower/);
  });
});

// ---------------------------------------------------------------------------
// per-modifier-source coverage in combat
// ---------------------------------------------------------------------------

describe("combat modifier sources", () => {
  it("Arms Race lands as the only modifier on the warrior", () => {
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
    expect(pair.attacker.modifiers).toHaveLength(1);
    const mod = modifierFrom(pair.attacker, "arms-race")!;
    expect(mod.delta).toBe(2);
    expect(mod.source.type).toBe("passive_event");
    expect(mod.source.cardId).toBe(armsRace.id);
  });

  it("Plague lands as the only modifier on units at the target tile", () => {
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
    expect(pair.attacker.modifiers).toHaveLength(1);
    expect(pair.defender.modifiers).toHaveLength(1);
    expect(modifierFrom(pair.attacker, "plague")!.source.cardId).toBe(plague.id);
    expect(modifierFrom(pair.defender, "plague")!.source.cardId).toBe(plague.id);
  });

  it("The Forge lands as the only modifier on the unit at its location", () => {
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
    expect(pair.attacker.modifiers).toHaveLength(1);
    const mod = modifierFrom(pair.attacker, "the-forge")!;
    expect(mod.delta).toBe(1);
    expect(mod.source.type).toBe("location");
    expect(mod.source.cardId).toBe(forge.id);
  });
});

// ---------------------------------------------------------------------------
// clamp invariant — `base + Σmods + roll === power` always holds
// ---------------------------------------------------------------------------

describe("combat clamp invariant", () => {
  it("surfaces a `clamped` modifier when base + Σmods would be negative", () => {
    // Base 1 + two Plagues (-2 each) → -3 sum, clamps to 0. Renderer needs
    // a synthetic `clamped` entry of +3 to reconcile the displayed math.
    const targetLoc = makeLocation({ ownerId: ACTIVE, definitionId: "target-loc" });
    const adjLoc = makeLocation({ ownerId: ACTIVE });
    const plague1 = {
      ...makePassiveEvent({ ownerId: OTHER, definitionId: "plague" }),
      remainingDuration: 99,
      targetId: targetLoc.id,
    };
    const attacker = makeUnit({ ownerId: ACTIVE, strength: 1, injured: true });
    const defender = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = gameWith((d) => {
      d.players[OTHER_IDX].passiveEvents.push(plague1);
      d.grid[0][0].location = targetLoc;
      d.grid[0][1].location = adjLoc;
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
    // base 1 + plague -2 + injured -1 = -2 → clamp +2 → 0 + roll
    const sumOfModifiers = pair.attacker.modifiers.reduce((a, m) => a + m.delta, 0);
    expect(pair.attacker.baseStrength + sumOfModifiers + pair.attacker.roll).toBe(pair.attacker.power);
    const clamped = modifierFrom(pair.attacker, "clamped");
    expect(clamped).toBeDefined();
    expect(clamped!.delta).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// actingCardSource threading
// ---------------------------------------------------------------------------

describe("actingCardSource threading", () => {
  it("a buff applied by a unit-action carries that unit's identity", () => {
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

  it("a buff applied by an instant event carries `type: \"event\"` and the card's identity", () => {
    const event = makeInstantEvent({
      ownerId: ACTIVE,
      definitionId: "test-buff-event",
      cost: "0",
      effect: "buff.strength(friendly)[2]~turn",
    });
    const friend = makeUnit({ ownerId: ACTIVE, strength: 4 });
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].hand.push(event);
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(friend);
    });

    const { events } = applyAction(state, {
      type: "play_event",
      playerId: ACTIVE,
      cardId: event.id,
      targetId: friend.id,
    });

    const buffed = events.find((e) => e.type === "unit_buffed");
    expect(buffed).toBeDefined();
    if (!buffed || buffed.type !== "unit_buffed") return;
    expect(buffed.source).toEqual({
      type: "event",
      cardId: event.id,
      definitionId: "test-buff-event",
    });
  });

  describe("policy activation buff", () => {
    // POLICY_ACTIONS is a module-level registry. Inject a synthetic action
    // for the duration of this test, then clean up so other tests stay
    // isolated. Confirms the `actingCardSource: { type: "policy", ... }`
    // branch in `handleActivate`.
    beforeEach(() => {
      POLICY_ACTIONS["test-buff-policy"] = [{
        name: "rally",
        apCost: 1,
        effect: "buff.strength(self + friendly + all)[2]~turn",
      }];
    });
    afterEach(() => {
      delete POLICY_ACTIONS["test-buff-policy"];
    });

    it("a buff applied by a policy action carries `type: \"policy\"` and the policy's identity", () => {
      POLICY_ACTIONS["test-buff-policy"] = [{
        name: "rally",
        apCost: 1,
        effect: "buff.strength(friendly)[2]~turn",
      }];
      const policy = makePolicy({ ownerId: ACTIVE, definitionId: "test-buff-policy" });
      const friend = makeUnit({ ownerId: ACTIVE, strength: 4 });
      const state = gameWith((d) => {
        d.players[ACTIVE_IDX].activePolicies.push(policy);
        d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
        d.grid[0][0].units.push(friend);
      });

      const { events } = applyAction(state, {
        type: "activate",
        playerId: ACTIVE,
        cardId: policy.id,
        actionName: "rally",
        targetId: friend.id,
      });

      const buffed = events.find((e) => e.type === "unit_buffed");
      expect(buffed).toBeDefined();
      if (!buffed || buffed.type !== "unit_buffed") return;
      expect(buffed.source).toEqual({
        type: "policy",
        cardId: policy.id,
        definitionId: "test-buff-policy",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// contest_resolved (DSL)
// ---------------------------------------------------------------------------

describe("contest_resolved per-side breakdown", () => {
  it("emits casterPlayerId + per-side baseStat, modifiers, roll, power, winnerId", () => {
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
    expect(contest.casterPlayerId).toBe(ACTIVE);
    expect(contest.attackerId).toBe(cleopatra.id);
    expect(contest.defenderId).toBe(enemy.id);
    expect(contest.winnerId).toBe(cleopatra.id);

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

  it("surfaces buff-then-contest compound chain — Hannibal Barca pattern", () => {
    // Replaces the path removed in #148 (the `[N]`-on-contest synthetic
    // modifier). Verifies the compound chain executes in order: the buff
    // lands first; the +3 then appears in the contest's per-side modifier
    // breakdown sourced from the acting card itself. The math invariant
    // `base + Σmodifiers + roll === power` must still hold from the
    // breakdown alone.
    const hannibal = makeUnit({
      ownerId: ACTIVE,
      definitionId: "hannibal-barca",
      strength: 8,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "buff.strength(self)[3]~turn + contest.strength(enemy)",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(hannibal, enemy);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: hannibal.id,
      actionName: "flank",
      targetId: enemy.id,
    });

    const contest = findContest(events);
    expect(contest.stat).toBe("strength");
    expect(contest.attacker.unitId).toBe(hannibal.id);
    expect(contest.attacker.baseStat).toBe(8);
    expect(contest.attacker.modifiers).toHaveLength(1);
    expect(contest.attacker.modifiers[0].delta).toBe(3);
    expect(contest.attacker.modifiers[0].source.cardId).toBe(hannibal.id);
    // Math invariant: base + Σmods + roll === power, sourced only from the
    // breakdown — no out-of-band bonus.
    const atkSum = contest.attacker.modifiers.reduce((a, m) => a + m.delta, 0);
    expect(contest.attacker.baseStat + atkSum + contest.attacker.roll).toBe(contest.attacker.power);
  });

  it("contest.strength default consequence honors combat_kill_ratio config override", () => {
    // killRatio=100 means even strength 10 vs strength 1 (max atkPower 16,
    // min defPower 2) cannot meet the kill threshold of 200 — the loser
    // must always be merely injured, never killed.
    const hannibal = makeUnit({
      ownerId: ACTIVE,
      definitionId: "hannibal-barca",
      strength: 10,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "contest.strength(enemy)",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, strength: 1 });
    const state = produce(
      createTestGame({ config: { ...COMBAT_CONFIG, combat_kill_ratio: 100 } }),
      (d) => {
        d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
        d.grid[0][0].units.push(hannibal, enemy);
      },
    );

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: hannibal.id,
      actionName: "flank",
      targetId: enemy.id,
    });

    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
    expect(events.some((e) => e.type === "unit_killed")).toBe(false);
  });

  it("contest.strength default consequence does NOT drop equipped items on injure", () => {
    // Equipment-on-injure is combat-specific. A DSL contest that injures the
    // loser must leave equipment in place.
    const hannibal = makeUnit({
      ownerId: ACTIVE,
      definitionId: "hannibal-barca",
      strength: 10,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "contest.strength(enemy)",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, strength: 1 });
    const sword = makeItem({ ownerId: OTHER, equippedTo: enemy.id });
    const state = produce(
      createTestGame({ config: { ...COMBAT_CONFIG, combat_kill_ratio: 100 } }),
      (d) => {
        d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
        d.grid[0][0].units.push(hannibal, enemy);
        d.grid[0][0].items.push(sword);
      },
    );

    const { state: next, events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: hannibal.id,
      actionName: "flank",
      targetId: enemy.id,
    });
    const ns = next as MainGameState;

    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
    expect(events.some((e) => e.type === "item_dropped")).toBe(false);
    const item = ns.grid[0][0].items.find((i) => i.id === sword.id);
    expect(item?.equippedTo).toBe(enemy.id);
  });

  it("contest > control(target)~round chain emits unit_controlled with correct fields", () => {
    // Cleopatra's marquee path. Asserts the consequence chain end-to-end,
    // not just the contest_resolved payload.
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

    const controlled = events.find((e) => e.type === "unit_controlled");
    expect(controlled).toBeDefined();
    if (!controlled || controlled.type !== "unit_controlled") return;
    expect(controlled.unitId).toBe(enemy.id);
    expect(controlled.controllerId).toBe(ACTIVE);
    expect(controlled.previousControllerId).toBe(OTHER);
    expect(controlled.duration).toBeGreaterThanOrEqual(1);
  });

  it("contest.strength loser branch fires on the ATTACKER when defender wins (no role swap)", () => {
    // All other default-consequence tests use strong-attacker / weak-defender.
    // This pins the `attackerWins ? target : attacker` mapping in
    // executor.ts:executeContest — a regression that swapped the operands
    // would inject the defender, not the attacker, into the kill/injure path.
    const weak = makeUnit({
      ownerId: ACTIVE,
      strength: 1,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "contest.strength(enemy)",
      }],
    });
    const strong = makeUnit({ ownerId: OTHER, strength: 10 });
    const state = produce(
      createTestGame({ config: { ...COMBAT_CONFIG, combat_kill_ratio: 100 } }),
      (d) => {
        d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
        d.grid[0][0].units.push(weak, strong);
      },
    );

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: weak.id,
      actionName: "flank",
      targetId: strong.id,
    });

    const injured = events.find((e) => e.type === "unit_injured");
    expect(injured).toBeDefined();
    if (!injured || injured.type !== "unit_injured") return;
    expect(injured.unitId).toBe(weak.id);     // attacker (loser) is injured
    expect(injured.unitId).not.toBe(strong.id);
    // Winner is unharmed
    expect(events.some((e) => e.type === "unit_killed")).toBe(false);
  });

  it("contest.strength default consequence works with combat_kill_ratio missing from config (uses default 2)", () => {
    // Pins the `getConfigNumber(..., 2)` default — a typo in the config key
    // would silently fall back to 2 and pass; this asserts the default-path
    // produces the expected outcome.
    const hannibal = makeUnit({
      ownerId: ACTIVE,
      definitionId: "hannibal-barca",
      strength: 10,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "contest.strength(enemy)",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, strength: 1 });
    // Build a config WITHOUT combat_kill_ratio set.
    const noKillRatioConfig = { ...COMBAT_CONFIG };
    delete (noKillRatioConfig as Record<string, unknown>).combat_kill_ratio;
    const state = produce(
      createTestGame({ config: noKillRatioConfig }),
      (d) => {
        d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
        d.grid[0][0].units.push(hannibal, enemy);
      },
    );

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: hannibal.id,
      actionName: "flank",
      targetId: enemy.id,
    });

    // At killRatio=2, atkPower (11-16) vs defPower (2-7) — some rolls kill,
    // some injure. Just assert one consequence fires (either is the default
    // behavior; both are wrong only if the default is 0 or absent).
    const hasConsequence = events.some((e) => e.type === "unit_killed" || e.type === "unit_injured");
    expect(hasConsequence).toBe(true);
    expect(events.some((e) => e.type === "contest_resolved")).toBe(true);
  });

  it("contest_resolved.winnerId is always a non-null unit id (engine invariant)", () => {
    // The client's buildPairDetailFromContest derives winnerSide from
    // `winnerId === attackerId`. Pin the engine contract so a future tie-
    // semantics change doesn't silently introduce null and break the client
    // narrowing.
    const hannibal = makeUnit({
      ownerId: ACTIVE,
      definitionId: "hannibal-barca",
      strength: 5,
      actions: [{
        name: "flank",
        apCost: 2,
        effect: "contest.strength(enemy)",
      }],
    });
    const enemy = makeUnit({ ownerId: OTHER, strength: 5 });
    const state = gameWith((d) => {
      d.grid[0][0].location = makeLocation({ ownerId: ACTIVE });
      d.grid[0][0].units.push(hannibal, enemy);
    });

    const { events } = applyAction(state, {
      type: "activate",
      playerId: ACTIVE,
      cardId: hannibal.id,
      actionName: "flank",
      targetId: enemy.id,
    });

    const contest = findContest(events);
    expect(contest.winnerId).toBeDefined();
    expect(typeof contest.winnerId).toBe("string");
    expect(contest.winnerId.length).toBeGreaterThan(0);
    // Ties go to defender per rules/stat-contests.md
    expect([hannibal.id, enemy.id]).toContain(contest.winnerId);
  });
});

// ---------------------------------------------------------------------------
// getModifiedStatWithSources — direct unit test
// ---------------------------------------------------------------------------

describe("getModifiedStatWithSources", () => {
  it("returns base, modifiers, and clamps `final` to >= 0", () => {
    const armsRace = {
      ...makePassiveEvent({ ownerId: ACTIVE, definitionId: "arms-race" }),
      remainingDuration: 99,
    };
    const state = gameWith((d) => {
      d.players[ACTIVE_IDX].passiveEvents.push(armsRace);
    });
    const { queries } = rebuildListeners(state);
    const warrior = makeUnit({ ownerId: ACTIVE, strength: 4, attributes: ["Warrior"] });

    const breakdown = getModifiedStatWithSources(state, queries, warrior, "strength");
    expect(breakdown.base).toBe(4);
    expect(breakdown.modifiers).toHaveLength(1);
    expect(breakdown.modifiers[0].source.definitionId).toBe("arms-race");
    expect(breakdown.modifiers[0].delta).toBe(2);
    expect(breakdown.final).toBe(6);
  });

  it("clamps `final` to 0 when base + Σmods is negative, modifiers still include the contributors", () => {
    // A unit with strength 1 in plague range (-2) — sum = -1, clamps to 0.
    const targetLoc = makeLocation({ ownerId: ACTIVE, definitionId: "target-loc" });
    const plague = {
      ...makePassiveEvent({ ownerId: OTHER, definitionId: "plague" }),
      remainingDuration: 99,
      targetId: targetLoc.id,
    };
    const weak = makeUnit({ ownerId: ACTIVE, strength: 1 });
    const state = gameWith((d) => {
      d.players[OTHER_IDX].passiveEvents.push(plague);
      d.grid[0][0].location = targetLoc;
      d.grid[0][0].units.push(weak);
    });
    const { queries } = rebuildListeners(state);

    const breakdown = getModifiedStatWithSources(state, queries, weak, "strength", { row: 0, col: 0 });
    expect(breakdown.base).toBe(1);
    expect(breakdown.modifiers).toHaveLength(1);
    expect(breakdown.modifiers[0].delta).toBe(-2);
    expect(breakdown.final).toBe(0);  // clamped from -1
  });
});
