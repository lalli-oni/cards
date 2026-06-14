import { describe, expect, it } from "bun:test";
import { buildPairDetail, type CombatPairResolved } from "../combatResult";

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
});
