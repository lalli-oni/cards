import { describe, expect, it } from "bun:test";
import type { PlayerDescriptor } from "cards-engine";
import { buildMainSetup, DEFAULT_CONFIG } from "../gameSetup";

const TWO_PLAYERS: PlayerDescriptor[] = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
];

function getActivePolicyDefIds(seed: string): Record<string, string[]> {
  const setup = buildMainSetup(TWO_PLAYERS, DEFAULT_CONFIG, seed);
  if (setup.mode !== "main") throw new Error("expected main-mode setup");
  return Object.fromEntries(
    Object.entries(setup.decks).map(([playerId, deck]) => [
      playerId,
      deck.activePolicies.map((p) => p.definitionId),
    ]),
  );
}

describe("buildMainSetup — policy assignment", () => {
  it("assigns 2 active policies per player (matching the seeded policy_selection flow)", () => {
    const policies = getActivePolicyDefIds("seed-1");
    expect(policies.p1).toHaveLength(2);
    expect(policies.p2).toHaveLength(2);
  });

  it("is deterministic for a given seed", () => {
    const first = getActivePolicyDefIds("seed-abc");
    const second = getActivePolicyDefIds("seed-abc");
    expect(second).toEqual(first);
  });

  it("does NOT give every player the same first policy (the militarist bug)", () => {
    // Sample several seeds — if the shuffle is wired the assignment varies.
    // The pre-fix code returned `playerPolicies[0]` (always the first definition
    // in library order, "militarist") for every player on every seed; a single
    // counter-example in this sample is enough to prove the bug is fixed.
    const seeds = ["aaa", "bbb", "ccc", "ddd", "eee"];
    const observedFirstPolicies = new Set<string>();
    for (const seed of seeds) {
      const policies = getActivePolicyDefIds(seed);
      observedFirstPolicies.add(policies.p1[0]);
      observedFirstPolicies.add(policies.p2[0]);
    }
    expect(observedFirstPolicies.size).toBeGreaterThan(1);
  });

  it("assigns independent policies to each player within a single setup", () => {
    // Each player's pool is shuffled independently via the same rng chain, so
    // p1 and p2 should not get identical policy sets on every seed. Sample
    // across several seeds and assert at least one disagreement.
    const seeds = ["aaa", "bbb", "ccc", "ddd", "eee"];
    let sawDisagreement = false;
    for (const seed of seeds) {
      const policies = getActivePolicyDefIds(seed);
      const p1Set = new Set(policies.p1);
      const p2Set = new Set(policies.p2);
      if (p1Set.size !== p2Set.size || [...p1Set].some((id) => !p2Set.has(id))) {
        sawDisagreement = true;
        break;
      }
    }
    expect(sawDisagreement).toBe(true);
  });
});
