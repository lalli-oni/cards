import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { applyBerserker } from "../apply-main";
import { getValidActions } from "../valid-actions";
import { rebuildListeners } from "../listeners/rebuild";
import { getModifiedStat, getModifiedStatWithSources, getModifiedCost, getModifiedAPCost, isUnitProtected } from "../listeners/query";
import { KeywordError } from "../keywords";
import type { Attribute } from "../attributes";
import type { GameEvent, MainAction, MainGameState, UnitCard } from "../types";
import {
  DEFAULT_CONFIG,
  createTestGame,
  makeItem,
  makeLocation,
  makeUnit,
  resetIds,
} from "./helpers";

beforeEach(() => resetIds());

/** Turn order is seed-randomized by `createGame` — never hardcode "p1"/"p2"
 *  as an owner or action `playerId`. Always route through `p.active`/`p.other`
 *  (inside `gameWith`'s mutator) or `getPlayers(state)` (after). */
function getPlayers(state: MainGameState) {
  const active = state.turn.activePlayerId;
  const other = state.players.find((p) => p.id !== active)!.id;
  const activeIdx = state.players.findIndex((p) => p.id === active);
  const otherIdx = state.players.findIndex((p) => p.id === other);
  return { active, other, activeIdx, otherIdx };
}

function gameWith(
  mutate: (d: MainGameState, p: ReturnType<typeof getPlayers>) => void,
  config = DEFAULT_CONFIG,
): MainGameState {
  const base = createTestGame({ config });
  const players = getPlayers(base);
  return produce(base, (d) => mutate(d as unknown as MainGameState, players));
}

// ---------------------------------------------------------------------------
// Phase 1 — modifier families (Prowess, Kindred, Leader, Aura)
// ---------------------------------------------------------------------------

describe("Prowess", () => {
  it("buffs the source unit only, gated on contest context", () => {
    let source!: UnitCard, other!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, strength: 5, keywords: ["Prowess:+2:strength:contest"] });
      other = makeUnit({ ownerId: p.active, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source, other);
    });
    const { queries } = rebuildListeners(state);

    // +2 under a contest ctx...
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(7);
    // ...but 0 without one (context gating).
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 })).toBe(5);
    // Scope is self only — a different unit at the same cell is unaffected.
    expect(getModifiedStat(state, queries, other, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(5);
  });

  it("mission context is a distinct discriminator from a bare read", () => {
    let source!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, cunning: 5, keywords: ["Prowess:+2:cunning:mission"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 }, undefined, true)).toBe(7);
    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 })).toBe(5);
  });

  it("`all` scope applies to every stat; a single-stat token applies to exactly one", () => {
    let allSource!: UnitCard, oneSource!: UnitCard;
    const state = gameWith((d, p) => {
      allSource = makeUnit({ ownerId: p.active, strength: 5, cunning: 5, charisma: 5, keywords: ["Prowess:+1:all:contest"] });
      oneSource = makeUnit({ ownerId: p.active, strength: 5, cunning: 5, keywords: ["Prowess:+1:strength:contest"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(allSource, oneSource);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    expect(getModifiedStat(state, queries, allSource, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, allSource, "cunning", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, allSource, "charisma", { row: 0, col: 0 }, ctx)).toBe(6);

    expect(getModifiedStat(state, queries, oneSource, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, oneSource, "cunning", { row: 0, col: 0 }, ctx)).toBe(5);
  });

  it("role gates atk/def; omitted or `either` applies to both", () => {
    let atkOnly!: UnitCard, defOnly!: UnitCard, either!: UnitCard, omitted!: UnitCard;
    const state = gameWith((d, p) => {
      atkOnly = makeUnit({ ownerId: p.active, strength: 5, keywords: ["Prowess:+1:strength:contest:atk"] });
      defOnly = makeUnit({ ownerId: p.active, strength: 5, keywords: ["Prowess:+1:strength:contest:def"] });
      either = makeUnit({ ownerId: p.active, strength: 5, keywords: ["Prowess:+1:strength:contest:either"] });
      omitted = makeUnit({ ownerId: p.active, strength: 5, keywords: ["Prowess:+1:strength:contest"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(atkOnly, defOnly, either, omitted);
    });
    const { queries } = rebuildListeners(state);
    const atkCtx = { role: "attacker" as const, row: 0, col: 0 };
    const defCtx = { role: "defender" as const, row: 0, col: 0 };

    expect(getModifiedStat(state, queries, atkOnly, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, atkOnly, "strength", { row: 0, col: 0 }, defCtx)).toBe(5);

    expect(getModifiedStat(state, queries, defOnly, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);
    expect(getModifiedStat(state, queries, defOnly, "strength", { row: 0, col: 0 }, atkCtx)).toBe(5);

    expect(getModifiedStat(state, queries, either, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, either, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);

    expect(getModifiedStat(state, queries, omitted, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, omitted, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);
  });

  it("a role clause on a mission token is rejected rather than silently ignored (D4)", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, keywords: ["Prowess:+1:strength:mission:atk"] }));
    });
    expect(() => rebuildListeners(state)).toThrow(KeywordError);
    expect(() => rebuildListeners(state)).toThrow(/role .* meaningless/);
  });
});

describe("Kindred", () => {
  it("buffs a friendly unit sharing an attribute, not the source itself, not a non-sharing/enemy unit", () => {
    let source!: UnitCard, sharer!: UnitCard, nonSharer!: UnitCard, enemySharer!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] });
      sharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Military"] });
      nonSharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Commerce"] });
      enemySharer = makeUnit({ ownerId: p.other, strength: 5, attributes: ["Military"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    expect(getModifiedStat(state, queries, sharer, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, nonSharer, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    expect(getModifiedStat(state, queries, enemySharer, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    // Not the source itself (D1).
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
  });

  it("attribute matching is case-insensitive", () => {
    let lowercaseSharer!: UnitCard;
    const state = gameWith((d, p) => {
      lowercaseSharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["military" as unknown as Attribute] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] }));
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, lowercaseSharer, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(6);
  });

  it("contributes nothing while the source sits in HQ (positional gating)", () => {
    let sharer!: UnitCard;
    const state = gameWith((d, p) => {
      sharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Military"] });
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] }),
      );
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, sharer, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(5);
  });
});

describe("Leader", () => {
  it("buffs friendlies at the same cell, not elsewhere, not enemies, but includes the source (D1)", () => {
    let source!: UnitCard, friendlyHere!: UnitCard, friendlyElsewhere!: UnitCard, enemyHere!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, keywords: ["Leader:+1:all:contest"] });
      friendlyHere = makeUnit({ ownerId: p.active, strength: 5 });
      friendlyElsewhere = makeUnit({ ownerId: p.active, strength: 5 });
      enemyHere = makeUnit({ ownerId: p.other, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    expect(getModifiedStat(state, queries, friendlyHere, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, friendlyElsewhere, "strength", { row: 0, col: 1 },
      { role: "attacker", row: 0, col: 1 })).toBe(5);
    expect(getModifiedStat(state, queries, enemyHere, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    // Leader includes the source itself (D1) — contrast with Kindred above.
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
  });

  it("contributes nothing while the source sits in HQ", () => {
    let friendly!: UnitCard;
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Leader:+1:all:contest"] }));
      friendly = makeUnit({ ownerId: p.active, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(friendly);
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 0 },
      { role: "attacker", row: 0, col: 0 })).toBe(5);
  });
});

describe("Aura", () => {
  it("debuffs both sides at that cell (friend and foe), nothing at another cell", () => {
    let friendly!: UnitCard, enemy!: UnitCard;
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, keywords: ["Aura:-1:all:contest"] });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      friendly = makeUnit({ ownerId: p.active, strength: 5 });
      enemy = makeUnit({ ownerId: p.other, strength: 5 });
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 0 }, ctx)).toBe(4);
    expect(getModifiedStat(state, queries, enemy, "strength", { row: 0, col: 0 }, ctx)).toBe(4);
    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 1 },
      { role: "attacker", row: 0, col: 1 })).toBe(5);
  });

  it("two keyword sources plus the target's own injury penalty sum as distinct modifier entries", () => {
    let target!: UnitCard;
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, keywords: ["Aura:-1:all:contest"] });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, keywords: ["Leader:-1:all:contest"] }));
      // Friendly (not the Leader source itself) so both Aura (no controller
      // filter) and Leader (friendly-only) apply to it.
      target = makeUnit({ ownerId: p.active, strength: 5, injured: true });
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    const breakdown = getModifiedStatWithSources(state, queries, target, "strength", { row: 0, col: 0 }, ctx);
    expect(breakdown.base).toBe(5);
    expect(breakdown.modifiers).toHaveLength(3); // Aura, Leader, injured — each a distinct source
    const definitionIds = breakdown.modifiers.map((m) => m.source.definitionId).sort();
    expect(definitionIds).toEqual(["injured", "test-location", "test-unit"]);
    expect(breakdown.final).toBe(2); // 5 - 1 (Aura) - 1 (Leader) - 1 (injury)
  });

  it("a stat driven below 0 clamps `final` at 0 while `base`/`modifiers` still report the raw math", () => {
    let target!: UnitCard;
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, keywords: ["Aura:-1:all:contest"] });
      target = makeUnit({ ownerId: p.other, strength: 0 });
    });
    const { queries } = rebuildListeners(state);
    const ctx = { role: "attacker" as const, row: 0, col: 0 };

    const breakdown = getModifiedStatWithSources(state, queries, target, "strength", { row: 0, col: 0 }, ctx);
    expect(breakdown.base).toBe(0);
    expect(breakdown.modifiers).toHaveLength(1);
    expect(breakdown.modifiers[0].delta).toBe(-1);
    expect(breakdown.final).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — cost / AP standalones
// ---------------------------------------------------------------------------

describe("Patron", () => {
  it("discounts buy and deploy for a sharing card, not a non-sharing card, floors at 0 (D8 no explicit min, D10 buy+deploy)", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Patron:1"] }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const sharingCard = makeUnit({ ownerId: active, cost: "3", attributes: ["Military"] });
    const nonSharingCard = makeUnit({ ownerId: active, cost: "3", attributes: ["Commerce"] });
    const cheapCard = makeUnit({ ownerId: active, cost: "0", attributes: ["Military"] });

    expect(getModifiedCost(state, queries, sharingCard, active, "buy")).toBe(2);
    expect(getModifiedCost(state, queries, sharingCard, active, "deploy")).toBe(2);
    expect(getModifiedCost(state, queries, nonSharingCard, active, "buy")).toBe(3);
    expect(getModifiedCost(state, queries, cheapCard, active, "buy")).toBe(0);
  });

  it("applies while the source sits in HQ (\"while in play\")", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Patron:1"] }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const card = makeUnit({ ownerId: active, cost: "3", attributes: ["Military"] });

    expect(getModifiedCost(state, queries, card, active, "buy")).toBe(2);
  });

  it("does not discount for the opposing player", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Patron:1"] }));
    });
    const { other } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const card = makeUnit({ ownerId: other, cost: "3", attributes: ["Military"] });

    expect(getModifiedCost(state, queries, card, other, "buy")).toBe(3);
  });
});

describe("Squire", () => {
  it("discounts an equip action's AP: -1 with no arg, stacks with a second source, floors at 0", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, keywords: ["Squire"] }),
        makeUnit({ ownerId: p.active, keywords: ["Squire:2"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const equipAction: MainAction = { type: "equip", playerId: active, itemId: "i1", unitId: "u1" };

    // Both sources present: -1 + -2 = -3, floored at 0 for a 1 AP base.
    expect(getModifiedAPCost(state, queries, equipAction, 1)).toBe(0);
  });

  it("Squire:2 alone discounts by exactly 2", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire:2"] }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const equipAction: MainAction = { type: "equip", playerId: active, itemId: "i1", unitId: "u1" };

    expect(getModifiedAPCost(state, queries, equipAction, 3)).toBe(1);
  });

  it("supplies the omitted-arg default of 1 itself (ParamSpec.default is display-only)", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire"] }));
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const equipAction: MainAction = { type: "equip", playerId: active, itemId: "i1", unitId: "u1" };

    expect(getModifiedAPCost(state, queries, equipAction, 1)).toBe(0);
  });

  it("does not discount another action type or the opposing player's equip", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire"] }));
    });
    const { active, other } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction: MainAction = { type: "move", playerId: active, unitId: "u1", row: 0, col: 0 };
    const opponentEquip: MainAction = { type: "equip", playerId: other, itemId: "i1", unitId: "u1" };

    expect(getModifiedAPCost(state, queries, moveAction, 1)).toBe(1);
    expect(getModifiedAPCost(state, queries, opponentEquip, 1)).toBe(1);
  });

  it("a full applyAction(equip) actually spends the discounted AP (regression for the old hardcoded spendAP(draft,1))", () => {
    let unit!: UnitCard;
    const state = gameWith((d, p) => {
      unit = makeUnit({ ownerId: p.active });
      const item = makeItem({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire"] }), unit, item);
    });
    const { active } = getPlayers(state);
    const item = state.players.find((pl) => pl.id === active)!.hq.find((c) => c.type === "item")!;
    const apBefore = state.turn.actionPointsRemaining;

    const { state: next } = applyAction(state, { type: "equip", playerId: active, itemId: item.id, unitId: unit.id });
    // Base equip cost 1, Squire -1 => 0 AP actually spent.
    expect((next as MainGameState).turn.actionPointsRemaining).toBe(apBefore);
  });

  it("getValidActions still offers equip at AP 0 (mirrors the Mary Shelley free-action precedent)", () => {
    const state = gameWith((d, p) => {
      const unit = makeUnit({ ownerId: p.active });
      const item = makeItem({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire"] }), unit, item);
      d.turn.actionPointsRemaining = 0;
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "equip")).toBe(true);
  });
});

describe("Heavy / Lightweight", () => {
  it("Heavy costs +1 AP, Lightweight -1 AP on the equipped unit's move; both together cancel", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: "u1", keywords: ["Heavy"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction: MainAction = { type: "move", playerId: active, unitId: "u1", row: 0, col: 0 };

    expect(getModifiedAPCost(state, queries, moveAction, 1)).toBe(2);

    const bothState = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: "u1", keywords: ["Heavy"] }),
        makeItem({ ownerId: p.active, definitionId: "swift-boots", equippedTo: "u1", keywords: ["Lightweight"] }),
      );
    });
    const { queries: bothQueries } = rebuildListeners(bothState);
    expect(getModifiedAPCost(bothState, bothQueries, moveAction, 1)).toBe(1);
  });

  it("an unequipped Heavy item contributes nothing", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", keywords: ["Heavy"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction: MainAction = { type: "move", playerId: active, unitId: "u1", row: 0, col: 0 };

    expect(getModifiedAPCost(state, queries, moveAction, 1)).toBe(1);
  });

  it("stacks with the injury move penalty", () => {
    const config = { ...DEFAULT_CONFIG, injury_move_penalty: 1 };
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: "u1", keywords: ["Heavy"] }),
      );
    }, config);
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction: MainAction = { type: "move", playerId: active, unitId: "u1", row: 0, col: 0 };
    const injuredBaseCost = 1 + 1; // base move (1) + injury_move_penalty (1)

    expect(getModifiedAPCost(state, queries, moveAction, injuredBaseCost)).toBe(3);
  });

  it("Lightweight applies on a retreat (row/col === -1, still a `move` action)", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeItem({ ownerId: p.active, definitionId: "swift-boots", equippedTo: "u1", keywords: ["Lightweight"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const retreatAction: MainAction = { type: "move", playerId: active, unitId: "u1", row: -1, col: -1 };

    expect(getModifiedAPCost(state, queries, retreatAction, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — combat hooks (Berserker, Loot)
// ---------------------------------------------------------------------------

describe("applyBerserker (pure)", () => {
  it("upgrades injure_defender to kill_defender and flags self-injury", () => {
    expect(applyBerserker("injure_defender", true)).toEqual({ outcome: "kill_defender", injureWinner: true });
  });

  it("upgrades injure_attacker to kill_attacker and flags self-injury", () => {
    expect(applyBerserker("injure_attacker", true)).toEqual({ outcome: "kill_attacker", injureWinner: true });
  });

  it("passes kill outcomes through untouched (would injure the loser, moot on an existing kill)", () => {
    expect(applyBerserker("kill_defender", true)).toEqual({ outcome: "kill_defender", injureWinner: false });
    expect(applyBerserker("kill_attacker", true)).toEqual({ outcome: "kill_attacker", injureWinner: false });
  });

  it("is the identity without Berserker", () => {
    expect(applyBerserker("injure_defender", false)).toEqual({ outcome: "injure_defender", injureWinner: false });
  });
});

describe("Berserker (integration)", () => {
  // Strength gap chosen so the attacker always wins (min power > max defender
  // power) and never naturally kills (max power < 2x min defender power) —
  // deterministic regardless of the 1-6 roll on either side.
  const NARROW_WIN = { attacker: 17, defender: 11 };
  // Pre-injured version of the same guarantee, accounting for the -1
  // injury_stat_penalty on the (already-injured) attacker.
  const NARROW_WIN_INJURED = { attacker: 31, defender: 21 };
  // Gap guaranteeing a natural 2x+ kill regardless of rolls.
  const LANDSLIDE = { attacker: 30, defender: 1 };

  function unitInjured(events: readonly GameEvent[], unitId: string): boolean {
    return events.some((e) => e.type === "unit_injured" && e.unitId === unitId);
  }
  function unitKilled(events: readonly GameEvent[], unitId: string): boolean {
    return events.some((e) => e.type === "unit_killed" && e.unitId === unitId);
  }

  it("a narrow win upgrades to a kill and injures the berserker attacker", () => {
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: NARROW_WIN.attacker, keywords: ["Berserker"] });
      defender = makeUnit({ ownerId: p.other, strength: NARROW_WIN.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    const pair = events.find((e) => e.type === "combat_pair_resolved");
    expect(pair && pair.type === "combat_pair_resolved" && pair.outcome).toBe("kill_defender");
    expect(unitKilled(events, defender.id)).toBe(true);
    expect(unitInjured(events, attacker.id)).toBe(true);
  });

  it("an already-injured berserker takes no further harm (D6) — loser still dies, berserker survives, still injured", () => {
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({
        ownerId: p.active, strength: NARROW_WIN_INJURED.attacker, injured: true, keywords: ["Berserker"],
      });
      defender = makeUnit({ ownerId: p.other, strength: NARROW_WIN_INJURED.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { state: next, events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(unitKilled(events, defender.id)).toBe(true);
    const survivor = (next as MainGameState).grid[0][0].units.find((u) => u.id === attacker.id);
    expect(survivor).toBeDefined();
    expect(survivor?.injured).toBe(true);
  });

  it("winning by 2x+ is already a kill — Berserker does not additionally self-injure", () => {
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: LANDSLIDE.attacker, keywords: ["Berserker"] });
      defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(unitKilled(events, defender.id)).toBe(true);
    expect(unitInjured(events, attacker.id)).toBe(false);
  });

  it("control: without Berserker, a narrow win only injures — no self-injury", () => {
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: NARROW_WIN.attacker });
      defender = makeUnit({ ownerId: p.other, strength: NARROW_WIN.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    const pair = events.find((e) => e.type === "combat_pair_resolved");
    expect(pair && pair.type === "combat_pair_resolved" && pair.outcome).toBe("injure_defender");
    expect(unitInjured(events, defender.id)).toBe(true);
    expect(unitInjured(events, attacker.id)).toBe(false);
  });
});

describe("Loot (integration)", () => {
  const LANDSLIDE = { attacker: 30, defender: 1 };
  const NARROW_WIN = { attacker: 17, defender: 11 };

  function cardDrawn(events: readonly GameEvent[]): boolean {
    return events.some((e) => e.type === "card_drawn");
  }

  it("drawing a card when the Loot unit kills an enemy", () => {
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: LANDSLIDE.attacker, keywords: ["Loot"] });
      const defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
    });
    const { active } = getPlayers(state);
    const handSizeBefore = state.players.find((pl) => pl.id === active)!.hand.length;

    const { state: next, events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(cardDrawn(events)).toBe(true);
    const handAfter = (next as MainGameState).players.find((pl) => pl.id === active)!.hand.length;
    expect(handAfter).toBe(handSizeBefore + 1);
  });

  it("no draw when the Loot unit merely injures", () => {
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: NARROW_WIN.attacker, keywords: ["Loot"] });
      const defender = makeUnit({ ownerId: p.other, strength: NARROW_WIN.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
      d.players[p.activeIdx].mainDeck.push(makeUnit({ ownerId: p.active }));
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(cardDrawn(events)).toBe(false);
  });

  it("empty main deck and empty discard: no draw, no throw", () => {
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: LANDSLIDE.attacker, keywords: ["Loot"] });
      const defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(cardDrawn(events)).toBe(false);
  });

  it("empty main deck, non-empty discard: reshuffles then draws", () => {
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, strength: LANDSLIDE.attacker, keywords: ["Loot"] });
      const defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
      d.players[p.activeIdx].discardPile.push(makeUnit({ ownerId: p.active }));
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    const shuffleIdx = events.findIndex((e) => e.type === "deck_shuffled");
    const drawIdx = events.findIndex((e) => e.type === "card_drawn");
    expect(shuffleIdx).toBeGreaterThanOrEqual(0);
    expect(drawIdx).toBeGreaterThan(shuffleIdx);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — legality gating (Untouchable, Flying)
// ---------------------------------------------------------------------------

describe("Untouchable", () => {
  it("shields a defender whose stat exceeds the lone attacker's — no attack offered, hand-crafted action rejected", () => {
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, charisma: 5 });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "attack")).toBe(false);
    expect(() => applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 }))
      .toThrow();
  });

  it("becomes legal once the attacker's (modified) stat is raised above the shield — pins that the comparison uses modified stats", () => {
    let leader!: UnitCard;
    const state = gameWith((d, p) => {
      leader = makeUnit({ ownerId: p.active, charisma: 5, keywords: ["Leader:+10:all:contest"] });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(leader, defender);
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "attack")).toBe(true);
    expect(() => applyAction(state, { type: "attack", playerId: active, unitIds: [leader.id], row: 0, col: 0 }))
      .not.toThrow();
  });

  it("two committed attackers, one above and one below the shield stat — attack legal, defender targetable (D5)", () => {
    let weakAttacker!: UnitCard, strongAttacker!: UnitCard;
    const state = gameWith((d, p) => {
      weakAttacker = makeUnit({ ownerId: p.active, charisma: 5 });
      strongAttacker = makeUnit({ ownerId: p.active, charisma: 20 });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(weakAttacker, strongAttacker, defender);
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "attack")).toBe(true);
    const { events } = applyAction(state, {
      type: "attack", playerId: active, unitIds: [weakAttacker.id, strongAttacker.id], row: 0, col: 0,
    });
    // Reaching combat_started at all means the (unshielded, since one
    // attacker exceeds it) defender was accepted as a target.
    expect(events.find((e) => e.type === "combat_started")).toBeDefined();
  });

  it("a shielded unit is excluded but an ordinary defender at the same cell remains targetable", () => {
    let attacker!: UnitCard, shielded!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, charisma: 5 });
      shielded = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      const ordinary = makeUnit({ ownerId: p.other, charisma: 1 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, shielded, ordinary);
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "attack")).toBe(true);
    const { state: next } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    // Combat resolved against the ordinary defender only — the shielded unit
    // is untouched at the cell (never entered `defenderUnitIds`).
    const shieldedStill = (next as MainGameState).grid[0][0].units.find((u) => u.id === shielded.id);
    expect(shieldedStill).toBeDefined();
    expect(shieldedStill?.injured).toBe(false);
  });

  it("does not leak into unrelated protection kinds — the shield is Attack-only", () => {
    let defender!: UnitCard;
    const state = gameWith((d, p) => {
      defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(defender);
    });
    const { queries } = rebuildListeners(state);

    // isUnitProtected has no "attack_target" caller here — Untouchable is
    // never registered as a ProtectionListener, so DSL contests / event
    // targeting see it exactly as if it had no protection at all.
    expect(isUnitProtected(state, queries, defender, { row: 0, col: 0 }, "contest_target", "charisma")).toBe(false);
    expect(isUnitProtected(state, queries, defender, { row: 0, col: 0 }, "event_target")).toBe(false);
  });
});

describe("Flying", () => {
  it("bypasses a blocked facing edge when the item is equipped to the moving unit", () => {
    let unit!: UnitCard;
    const state = gameWith((d, p) => {
      unit = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active, edges: { n: true, e: false, s: true, w: true } });
      d.grid[0][1].location = makeLocation({ ownerId: p.active, edges: { n: true, e: true, s: true, w: false } });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, equippedTo: unit.id, keywords: ["Flying"] }));
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "move" && a.unitId === unit.id && a.row === 0 && a.col === 1)).toBe(true);
    expect(() => applyAction(state, { type: "move", playerId: active, unitId: unit.id, row: 0, col: 1 })).not.toThrow();
  });

  it("does not bypass a missing destination location or non-adjacency", () => {
    let unit!: UnitCard;
    const state = gameWith((d, p) => {
      unit = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active, edges: { n: true, e: false, s: true, w: true } });
      // grid[0][1] has no location at all.
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, equippedTo: unit.id, keywords: ["Flying"] }));
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "move" && a.unitId === unit.id && a.row === 0 && a.col === 1)).toBe(false);
  });

  it("does not bypass when the Flying item is equipped to a different unit at the cell", () => {
    let unit!: UnitCard, otherUnit!: UnitCard;
    const state = gameWith((d, p) => {
      unit = makeUnit({ ownerId: p.active });
      otherUnit = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active, edges: { n: true, e: false, s: true, w: true } });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(unit, otherUnit);
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, equippedTo: otherUnit.id, keywords: ["Flying"] }));
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    expect(actions.some((a) => a.type === "move" && a.unitId === unit.id && a.row === 0 && a.col === 1)).toBe(false);
    // The item's own bearer still benefits.
    expect(actions.some((a) => a.type === "move" && a.unitId === otherUnit.id && a.row === 0 && a.col === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

describe("bad data at runtime", () => {
  it("a malformed keyword token throws KeywordError with the offending token", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, keywords: ["Prowess:not-a-number:strength:contest"] }));
    });

    expect(() => rebuildListeners(state)).toThrow(KeywordError);
    expect(() => rebuildListeners(state)).toThrow(/Prowess/);
  });
});
