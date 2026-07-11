import { describe, expect, it } from "bun:test";
import { canonicalActionKey, isLegalAction } from "../action-validation";
import type { Action } from "../types";

// Helpers to build the payloads the enumerator emits, as plain literals — this
// suite exercises the pure membership check, so it needs no game state.
function sitOut(ids: string[]): Action {
  return {
    type: "resolve_combat_round",
    playerId: "p1",
    decision: { kind: "sit_out", sitOutUnitIds: ids },
  };
}

function matchups(pairs: [string, string][]): Action {
  return {
    type: "resolve_combat_round",
    playerId: "p1",
    decision: {
      kind: "assign_matchups",
      pairs: pairs.map(([attackerUnitId, defenderUnitId]) => ({
        attackerUnitId,
        defenderUnitId,
      })),
    },
  };
}

function pick(ids: [string, ...string[]]): Action {
  return { type: "resolve_pick", playerId: "p1", pickedCardIds: ids };
}

describe("isLegalAction", () => {
  it("accepts an action that exactly matches an enumerated entry", () => {
    const valid = [sitOut(["u1", "u2"]), sitOut(["u1", "u3"])];
    expect(isLegalAction(sitOut(["u1", "u2"]), valid)).toBe(true);
  });

  it("accepts a valid sit_out submitted in a different id order (regression guard)", () => {
    // The overlay builds sitOutUnitIds in click order; the enumerator emits
    // them power-ascending. An order-sensitive check would false-reject this.
    const valid = [sitOut(["u1", "u2"]), sitOut(["u1", "u3"])];
    expect(isLegalAction(sitOut(["u2", "u1"]), valid)).toBe(true);
  });

  it("accepts assign_matchups with the pairs array reordered", () => {
    const valid = [
      matchups([
        ["a1", "d1"],
        ["a2", "d2"],
      ]),
    ];
    // Same bijection, pairs listed in the other order.
    expect(
      isLegalAction(
        matchups([
          ["a2", "d2"],
          ["a1", "d1"],
        ]),
        valid,
      ),
    ).toBe(true);
  });

  it("accepts a deck_pick submitted in a different order than enumerated", () => {
    const valid = [pick(["c1", "c2"]), pick(["c1", "c3"])];
    expect(isLegalAction(pick(["c2", "c1"]), valid)).toBe(true);
  });

  it("accepts any enumerated scholar_reorder permutation", () => {
    // scholar_reorder enumerates the whole permutation orbit; every ordering is
    // legal, so an order-insensitive match still returns the correct verdict.
    const valid = [
      pick(["c1", "c2", "c3"]),
      pick(["c1", "c3", "c2"]),
      pick(["c2", "c1", "c3"]),
      pick(["c2", "c3", "c1"]),
      pick(["c3", "c1", "c2"]),
      pick(["c3", "c2", "c1"]),
    ];
    expect(isLegalAction(pick(["c3", "c1", "c2"]), valid)).toBe(true);
  });

  // --- The cases the old shallow (type + playerId) gate let through ---------

  it("rejects a sit_out whose id is not on the larger side", () => {
    const valid = [sitOut(["u1", "u2"]), sitOut(["u1", "u3"])];
    expect(isLegalAction(sitOut(["u1", "u9"]), valid)).toBe(false);
  });

  it("rejects assign_matchups pairing a defender not in the prompt", () => {
    const valid = [
      matchups([
        ["a1", "d1"],
        ["a2", "d2"],
      ]),
    ];
    expect(
      isLegalAction(
        matchups([
          ["a1", "d1"],
          ["a2", "d9"],
        ]),
        valid,
      ),
    ).toBe(false);
  });

  it("rejects a decision kind the prompt did not offer", () => {
    // A sit_out prompt: submitting a retreat has the right type + playerId but
    // an illegal payload — exactly what the shallow gate missed.
    const valid = [sitOut(["u1", "u2"])];
    const retreat: Action = {
      type: "resolve_combat_round",
      playerId: "p1",
      decision: { kind: "retreat", retreat: true },
    };
    expect(isLegalAction(retreat, valid)).toBe(false);
  });

  it("rejects a resolve_pick set that isn't an enumerated subset", () => {
    const valid = [pick(["c1", "c2"]), pick(["c1", "c3"])];
    expect(isLegalAction(pick(["c2", "c3"]), valid)).toBe(false);
  });

  it("rejects a resolve_pick superset of an enumerated entry", () => {
    // The mirror of the subset case: submitting MORE ids than any enumerated
    // entry must fail too — canonicalization is length-sensitive, so sorting
    // collapses permutations only, never grows or shrinks the set.
    const valid = [pick(["c1", "c2"]), pick(["c1", "c3"])];
    expect(isLegalAction(pick(["c1", "c2", "c3"]), valid)).toBe(false);
  });

  it("rejects a scholar_reorder multiset outside the enumerated orbit", () => {
    // The order-safety proof rests on the WHOLE permutation orbit being
    // enumerated (so collapsing orderings can't admit an illegal action). A
    // submission whose multiset isn't in the orbit — a duplicated id, or an
    // id the prompt never offered — must still be rejected even though it has
    // the orbit's length. This isolates the claim the reject side otherwise
    // only exercises via plain subsets.
    const orbit = [
      pick(["c1", "c2", "c3"]),
      pick(["c1", "c3", "c2"]),
      pick(["c2", "c1", "c3"]),
      pick(["c2", "c3", "c1"]),
      pick(["c3", "c1", "c2"]),
      pick(["c3", "c2", "c1"]),
    ];
    expect(isLegalAction(pick(["c1", "c1", "c2"]), orbit)).toBe(false); // duplicate
    expect(isLegalAction(pick(["c1", "c2", "c4"]), orbit)).toBe(false); // out-of-orbit id
  });

  it("returns false against an empty valid set", () => {
    expect(isLegalAction(sitOut(["u1"]), [])).toBe(false);
  });

  // Deep validation is deliberately scoped to the exhaustively-enumerated
  // decision actions. Template-style actions (seed_keep and the rotation-bearing
  // seeding/raze actions) keep the shallow type+playerId check, because their
  // enumeration is a template the adapter fills — a deep-equal would false-reject.
  it("shallow-accepts a filled seed_keep against its enumerated template", () => {
    const valid: Action[] = [
      { type: "seed_keep", playerId: "p1", keepIds: [], exposeIds: [] },
    ];
    const filled: Action = {
      type: "seed_keep",
      playerId: "p1",
      keepIds: ["c1", "c2"],
      exposeIds: ["c3"],
    };
    expect(isLegalAction(filled, valid)).toBe(true);
  });

  it("still rejects a template-style action for the wrong player", () => {
    const valid: Action[] = [
      { type: "seed_keep", playerId: "p1", keepIds: [], exposeIds: [] },
    ];
    const wrongPlayer: Action = {
      type: "seed_keep",
      playerId: "p2",
      keepIds: [],
      exposeIds: [],
    };
    expect(isLegalAction(wrongPlayer, valid)).toBe(false);
  });

  it("shallow-rejects a template-style action against an empty valid set", () => {
    // The shallow branch is a distinct code path from the deep branch's
    // empty-set reject — guard it directly.
    const filled: Action = {
      type: "seed_keep",
      playerId: "p1",
      keepIds: ["c1"],
      exposeIds: [],
    };
    expect(isLegalAction(filled, [])).toBe(false);
  });

  it("shallow-rejects when only a different action type is enumerated", () => {
    const valid: Action[] = [{ type: "pass", playerId: "p1" }];
    const filled: Action = {
      type: "seed_keep",
      playerId: "p1",
      keepIds: [],
      exposeIds: [],
    };
    expect(isLegalAction(filled, valid)).toBe(false);
  });
});

describe("canonicalActionKey", () => {
  it("is invariant to object key order", () => {
    const a: Action = {
      type: "buy",
      playerId: "p1",
      cardId: "c1",
      costIndex: 0,
    };
    const b = {
      costIndex: 0,
      cardId: "c1",
      playerId: "p1",
      type: "buy",
    } as Action;
    expect(canonicalActionKey(a)).toBe(canonicalActionKey(b));
  });

  it("treats an explicit undefined field the same as an omitted one", () => {
    const withUndef: Action = {
      type: "buy",
      playerId: "p1",
      cardId: "c1",
      costIndex: undefined,
    };
    const without = { type: "buy", playerId: "p1", cardId: "c1" } as Action;
    expect(canonicalActionKey(withUndef)).toBe(canonicalActionKey(without));
  });

  it("collapses permutations but distinguishes subsets", () => {
    const full = canonicalActionKey(pick(["c1", "c2", "c3"]));
    const reordered = canonicalActionKey(pick(["c3", "c1", "c2"]));
    const subset = canonicalActionKey(pick(["c1", "c2"]));
    expect(reordered).toBe(full); // permutation-invariant
    expect(subset).not.toBe(full); // subset-sensitive
  });

  it("drops an undefined field nested inside a decision payload", () => {
    // The undefined-dropping recurses to any depth, not just the top level.
    const withUndef = {
      type: "resolve_combat_round",
      playerId: "p1",
      decision: { kind: "retreat", retreat: true, extra: undefined },
    } as unknown as Action;
    const without = {
      type: "resolve_combat_round",
      playerId: "p1",
      decision: { kind: "retreat", retreat: true },
    } as unknown as Action;
    expect(canonicalActionKey(withUndef)).toBe(canonicalActionKey(without));
  });

  it("sorts an array of objects order-insensitively", () => {
    // Exercises the array-of-objects comparator (each element canonicalized
    // then stringified) directly, not just via assign_matchups.
    const a = matchups([
      ["a1", "d1"],
      ["a2", "d2"],
    ]);
    const b = matchups([
      ["a2", "d2"],
      ["a1", "d1"],
    ]);
    expect(canonicalActionKey(a)).toBe(canonicalActionKey(b));
  });
});
