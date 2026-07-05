import { describe, expect, it } from "bun:test";
import type { GameEvent } from "cards-engine";
import {
  buildDialogView,
  buildPairDetail,
  buildPairDetailFromContest,
  stepCombatBuffer,
  type CombatPairResolved,
  type ContestResolved,
  type ContestResult,
} from "../contestResult";

const RESOLVERS = {
  card: (id: string) => `card:${id}`,
  player: (id: string) => `player:${id}`,
};

function makeEvent(outcome: CombatPairResolved["outcome"]): CombatPairResolved {
  return {
    type: "combat_pair_resolved",
    row: 0,
    col: 0,
    attackerPlayerId: "p1",
    defenderPlayerId: "p2",
    attacker: { unitId: "atk", baseStrength: 5, modifiers: [], roll: 3, power: 8, injuredBefore: false },
    defender: { unitId: "def", baseStrength: 5, modifiers: [], roll: 3, power: 8, injuredBefore: false },
    outcome,
  };
}

describe("buildPairDetail", () => {
  it("kill_defender → winnerSide 'attacker'", () => {
    expect(buildPairDetail(makeEvent("kill_defender"), RESOLVERS).winnerSide).toBe("attacker");
  });
  it("injure_defender → winnerSide 'attacker'", () => {
    expect(buildPairDetail(makeEvent("injure_defender"), RESOLVERS).winnerSide).toBe("attacker");
  });
  it("kill_attacker → winnerSide 'defender'", () => {
    expect(buildPairDetail(makeEvent("kill_attacker"), RESOLVERS).winnerSide).toBe("defender");
  });
  it("injure_attacker → winnerSide 'defender'", () => {
    expect(buildPairDetail(makeEvent("injure_attacker"), RESOLVERS).winnerSide).toBe("defender");
  });
  it("tie → winnerSide null", () => {
    expect(buildPairDetail(makeEvent("tie"), RESOLVERS).winnerSide).toBe(null);
  });

  it("resolves names via the provided resolvers", () => {
    const detail = buildPairDetail(makeEvent("kill_defender"), RESOLVERS);
    expect(detail.attacker.unitName).toBe("card:atk");
    expect(detail.attacker.ownerName).toBe("player:p1");
    expect(detail.defender.unitName).toBe("card:def");
    expect(detail.defender.ownerName).toBe("player:p2");
  });

  it("passes ModifierEntry through unchanged", () => {
    const ev = makeEvent("kill_defender");
    ev.attacker.modifiers = [
      { source: { type: "passive_event", cardId: "ar-1", definitionId: "arms-race" }, delta: 2 },
    ];
    const detail = buildPairDetail(ev, RESOLVERS);
    expect(detail.attacker.modifiers).toEqual(ev.attacker.modifiers);
  });

  it("maps engine baseStrength to view baseStat", () => {
    const detail = buildPairDetail(makeEvent("injure_defender"), RESOLVERS);
    expect(detail.attacker.baseStat).toBe(5);
    expect(detail.defender.baseStat).toBe(5);
  });
});

describe("stepCombatBuffer", () => {
  const started: GameEvent = { type: "combat_started", row: 0, col: 0, attackerId: "p1", defenderId: "p2" };
  const resolved: GameEvent = { type: "combat_resolved", row: 0, col: 0, winnerId: "p1" };
  const pair: GameEvent = makeEvent("kill_defender");
  const injured: GameEvent = { type: "unit_injured", unitId: "def", controllerId: "p2" };
  const unrelated: GameEvent = { type: "turn_started", playerId: "p1", round: 1 };

  it("atomic combat (start+pair+resolved in one batch) completes with all events, empty buffer", () => {
    const step = stepCombatBuffer([], [started, pair, injured, resolved]);
    expect(step.outcome.kind).toBe("complete");
    if (step.outcome.kind !== "complete") return;
    expect(step.outcome.dialogEvents).toEqual([started, pair, injured, resolved]);
    expect(step.buffer).toEqual([]);
  });

  it("start with no resolve → suspended, buffering the started context", () => {
    const step = stepCombatBuffer([], [started]);
    expect(step.outcome.kind).toBe("suspended");
    expect(step.buffer).toEqual([started]);
  });

  it("resume batch completes the fight using the buffered start", () => {
    const step = stepCombatBuffer([started], [pair, injured, resolved]);
    expect(step.outcome.kind).toBe("complete");
    if (step.outcome.kind !== "complete") return;
    // Whole fight, start (buffered) through resolved (this batch).
    expect(step.outcome.dialogEvents).toEqual([started, pair, injured, resolved]);
    expect(step.buffer).toEqual([]);
  });

  it("multi-round: a resume that resolves a round and suspends again accumulates, no dialog yet", () => {
    const step = stepCombatBuffer([started], [pair]);
    expect(step.outcome.kind).toBe("none");
    expect(step.buffer).toEqual([started, pair]);
    // The next resume finally resolves — dialog carries both rounds' pairs.
    const final = stepCombatBuffer(step.buffer, [pair, resolved]);
    expect(final.outcome.kind).toBe("complete");
    if (final.outcome.kind !== "complete") return;
    expect(final.outcome.dialogEvents).toEqual([started, pair, pair, resolved]);
  });

  it("a pair with no buffered start is a true orphan", () => {
    const step = stepCombatBuffer([], [pair]);
    expect(step.outcome.kind).toBe("orphan");
  });

  it("a batch with no combat activity is 'none' and leaves the buffer untouched", () => {
    expect(stepCombatBuffer([], [unrelated]).outcome.kind).toBe("none");
    expect(stepCombatBuffer([started], [unrelated]).buffer).toEqual([started]);
  });

  it("a fresh combat_started discards a stale non-empty buffer (no cross-fight leak)", () => {
    const started2: GameEvent = { type: "combat_started", row: 1, col: 1, attackerId: "p2", defenderId: "p1" };
    const pair2: GameEvent = makeEvent("kill_attacker");
    const resolved2: GameEvent = { type: "combat_resolved", row: 1, col: 1, winnerId: "p2" };
    // Previous fight left [started, pair] buffered; a new atomic fight arrives.
    const step = stepCombatBuffer([started, pair], [started2, pair2, resolved2]);
    expect(step.outcome.kind).toBe("complete");
    if (step.outcome.kind !== "complete") return;
    // Only the second fight's events — the stale buffer is dropped, not leaked.
    expect(step.outcome.dialogEvents).toEqual([started2, pair2, resolved2]);
  });

  it("a resolve with no buffered start is orphan, not a silent empty completion", () => {
    // Reachable after a save/load mid-suspended-combat that reset the buffer: the
    // resume batch resolves the fight but carries no combat_started.
    const step = stepCombatBuffer([], [pair, resolved]);
    expect(step.outcome.kind).toBe("orphan");
  });
});

describe("buildPairDetailFromContest", () => {
  function makeContestEvent(winnerSide: "attacker" | "defender"): ContestResolved {
    return {
      type: "contest_resolved",
      stat: "charisma",
      casterPlayerId: "p1",
      attackerId: "atk-unit",
      defenderId: "def-unit",
      attacker: { unitId: "atk-unit", baseStat: 9, modifiers: [], roll: 3, power: 12 },
      defender: { unitId: "def-unit", baseStat: 4, modifiers: [], roll: 5, power: 9 },
      winnerId: winnerSide === "attacker" ? "atk-unit" : "def-unit",
    };
  }

  it("derives winnerSide from winnerId vs attackerId", () => {
    expect(buildPairDetailFromContest(makeContestEvent("attacker"), RESOLVERS, "player:p2").winnerSide).toBe("attacker");
    expect(buildPairDetailFromContest(makeContestEvent("defender"), RESOLVERS, "player:p2").winnerSide).toBe("defender");
  });

  it("uses casterPlayerId for attacker ownerName and the passed-in name for defender", () => {
    const detail = buildPairDetailFromContest(makeContestEvent("attacker"), RESOLVERS, "Bob");
    expect(detail.attacker.ownerName).toBe("player:p1");
    expect(detail.defender.ownerName).toBe("Bob");
  });

  it("maps baseStat through unchanged", () => {
    const detail = buildPairDetailFromContest(makeContestEvent("attacker"), RESOLVERS, "player:p2");
    expect(detail.attacker.baseStat).toBe(9);
    expect(detail.defender.baseStat).toBe(4);
  });

  it("throws when defenderOwnerName is empty (caller contract)", () => {
    expect(() => buildPairDetailFromContest(makeContestEvent("attacker"), RESOLVERS, "")).toThrow(/defenderOwnerName/);
  });
});

describe("buildDialogView", () => {
  function combatResult(overrides: Partial<Extract<ContestResult, { source: "combat" }>> = {}): ContestResult {
    return {
      source: "combat",
      stat: "strength",
      row: 0, col: 0,
      locationName: "Marketplace",
      attackerName: "Alice",
      defenderName: "Bob",
      attackerId: "p1",
      defenderId: "p2",
      pairs: [],
      outcomes: [],
      winnerName: null,
      ...overrides,
    };
  }
  function dslResult(overrides: Partial<Extract<ContestResult, { source: "dsl" }>> = {}): ContestResult {
    return {
      source: "dsl",
      stat: "charisma",
      row: 0, col: 0,
      locationName: "Palace",
      attackerName: "Cleopatra-owner",
      defenderName: "Tank-owner",
      pairs: [],
      outcomes: [],
      winnerName: "Cleopatra-owner",
      ...overrides,
    };
  }

  it("combat → 'Combat at {loc}' title, showPairCaption, draw copy", () => {
    const view = buildDialogView(combatResult());
    expect(view.title).toBe("Combat at Marketplace");
    expect(view.showPairCaption).toBe(true);
    expect(view.emptyOutcomesMsg).toBe("No casualties — draw!");
  });

  it("dsl with winner → '{Stat} contest at {loc}' title, no caption, null empty-msg (footer carries it)", () => {
    const view = buildDialogView(dslResult({ stat: "charisma" }));
    expect(view.title).toBe("Charisma contest at Palace");
    expect(view.showPairCaption).toBe(false);
    expect(view.emptyOutcomesMsg).toBe(null);
  });

  it("dsl strength contest capitalizes stat in title", () => {
    const view = buildDialogView(dslResult({ stat: "strength", locationName: "Battlefield" }));
    expect(view.title).toBe("Strength contest at Battlefield");
  });

  it("dsl cunning contest capitalizes stat in title", () => {
    const view = buildDialogView(dslResult({ stat: "cunning" }));
    expect(view.title).toBe("Cunning contest at Palace");
  });
});
