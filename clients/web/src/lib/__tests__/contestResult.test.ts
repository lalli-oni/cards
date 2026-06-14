import { describe, expect, it } from "bun:test";
import {
  buildPairDetail,
  buildPairDetailFromContest,
  type CombatPairResolved,
  type ContestResolved,
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

  it("maps baseStat through unchanged and sets injuredBefore=false (contests don't carry it)", () => {
    const detail = buildPairDetailFromContest(makeContestEvent("attacker"), RESOLVERS, "player:p2");
    expect(detail.attacker.baseStat).toBe(9);
    expect(detail.defender.baseStat).toBe(4);
    expect(detail.attacker.injuredBefore).toBe(false);
    expect(detail.defender.injuredBefore).toBe(false);
  });
});
