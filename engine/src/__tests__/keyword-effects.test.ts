import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { applyBerserker } from "../apply-main";
import { getValidActions } from "../valid-actions";
import { rebuildListeners } from "../listeners/rebuild";
import { getModifiedStat, getModifiedStatWithSources, getModifiedCost, getModifiedAPCost, isUnitProtected } from "../listeners/query";
import { KeywordError } from "../keywords";
import type { Attribute } from "../attributes";
import type { GameEvent, ItemCard, LocationCard, MainAction, MainGameState, UnitCard } from "../types";
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
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(7);
    // ...but 0 without one (context gating).
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 })).toBe(5);
    // Scope is self only — a different unit at the same cell is unaffected.
    expect(getModifiedStat(state, queries, other, "strength", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(5);
  });

  it("mission context is a distinct discriminator from a bare read", () => {
    let source!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, cunning: 5, keywords: ["Prowess:+2:cunning:mission"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 }, { mission: true })).toBe(7);
    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 })).toBe(5);
    // ...and a mission token must not fire during a contest.
    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(5);
  });

  it("a contest token stays out of the mission sum (the mirror of the case above)", () => {
    // The two occasions have to be disjoint in BOTH directions. Only the
    // mission→contest leg was pinned, so making the contest branch answer
    // `ctx.mission === true` broke nothing.
    let source!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, cunning: 5, keywords: ["Prowess:+2:cunning:contest"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(7);
    expect(getModifiedStat(state, queries, source, "cunning", { row: 0, col: 0 }, { mission: true })).toBe(5);
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
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

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
    const atkCtx = { contest: { role: "attacker" as const, row: 0, col: 0 } };
    const defCtx = { contest: { role: "defender" as const, row: 0, col: 0 } };

    expect(getModifiedStat(state, queries, atkOnly, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, atkOnly, "strength", { row: 0, col: 0 }, defCtx)).toBe(5);

    expect(getModifiedStat(state, queries, defOnly, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);
    expect(getModifiedStat(state, queries, defOnly, "strength", { row: 0, col: 0 }, atkCtx)).toBe(5);

    expect(getModifiedStat(state, queries, either, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, either, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);

    expect(getModifiedStat(state, queries, omitted, "strength", { row: 0, col: 0 }, atkCtx)).toBe(6);
    expect(getModifiedStat(state, queries, omitted, "strength", { row: 0, col: 0 }, defCtx)).toBe(6);
  });

  it("a role clause on a mission token is rejected rather than silently ignored", () => {
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
    // Every queried unit really stands on the cell it is queried at. The query
    // layer only reads the ctx, so synthetic positions would pass too — but
    // then nothing would check that real board placement gives the same answer.
    let source!: UnitCard, sharer!: UnitCard, nonSharer!: UnitCard, enemySharer!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] });
      sharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Military"] });
      nonSharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Commerce"] });
      enemySharer = makeUnit({ ownerId: p.other, strength: 5, attributes: ["Military"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source, sharer, nonSharer, enemySharer);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

    expect(getModifiedStat(state, queries, sharer, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, nonSharer, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    expect(getModifiedStat(state, queries, enemySharer, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    // Excludes the source itself — contrast with Leader below, which includes it.
    expect(getModifiedStat(state, queries, source, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
  });

  it("reaches kin anywhere on the board — deliberately not location-scoped like Leader", () => {
    // Kindred's rules entry carries no location clause, unlike Leader's. That
    // asymmetry is easy to "tidy away" into a same-cell check, so pin it: the
    // kin stands two cells from the source and is still buffed.
    let sharer!: UnitCard;
    const state = gameWith((d, p) => {
      sharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Military"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] }),
      );
      d.grid[0][1].units.push(sharer);
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, sharer, "strength", { row: 0, col: 1 },
      { contest: { role: "attacker", row: 0, col: 1 } })).toBe(6);
  });

  it("attribute matching is case-insensitive", () => {
    let lowercaseSharer!: UnitCard;
    const state = gameWith((d, p) => {
      lowercaseSharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["military" as unknown as Attribute] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] }),
        lowercaseSharer,
      );
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, lowercaseSharer, "strength", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(6);
  });

  it("contributes nothing while the source sits in HQ (positional gating)", () => {
    let sharer!: UnitCard;
    const state = gameWith((d, p) => {
      sharer = makeUnit({ ownerId: p.active, strength: 5, attributes: ["Military"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(sharer);
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Kindred:+1:all:contest"] }),
      );
    });
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, sharer, "strength", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(5);
  });
});

describe("Leader", () => {
  it("buffs friendlies at the same cell, not elsewhere, not enemies, and includes the source", () => {
    let source!: UnitCard, friendlyHere!: UnitCard, friendlyElsewhere!: UnitCard, enemyHere!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, keywords: ["Leader:+1:all:contest"] });
      friendlyHere = makeUnit({ ownerId: p.active, strength: 5 });
      friendlyElsewhere = makeUnit({ ownerId: p.active, strength: 5 });
      enemyHere = makeUnit({ ownerId: p.other, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source, friendlyHere, enemyHere);
      d.grid[0][1].units.push(friendlyElsewhere);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

    expect(getModifiedStat(state, queries, friendlyHere, "strength", { row: 0, col: 0 }, ctx)).toBe(6);
    expect(getModifiedStat(state, queries, friendlyElsewhere, "strength", { row: 0, col: 1 },
      { contest: { role: "attacker", row: 0, col: 1 } })).toBe(5);
    expect(getModifiedStat(state, queries, enemyHere, "strength", { row: 0, col: 0 }, ctx)).toBe(5);
    // Leader includes the source itself — contrast with Kindred above.
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
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(5);
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
      d.grid[0][0].units.push(friendly, enemy);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 0 }, ctx)).toBe(4);
    expect(getModifiedStat(state, queries, enemy, "strength", { row: 0, col: 0 }, ctx)).toBe(4);
    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 1 },
      { contest: { role: "attacker", row: 0, col: 1 } })).toBe(5);
  });

  it("two keyword sources plus the target's own injury penalty sum as distinct modifier entries", () => {
    let target!: UnitCard, auraLocation!: LocationCard, leaderSource!: UnitCard;
    const state = gameWith((d, p) => {
      auraLocation = makeLocation({ ownerId: p.active, keywords: ["Aura:-1:all:contest"] });
      leaderSource = makeUnit({ ownerId: p.active, keywords: ["Leader:-1:all:contest"] });
      // Friendly (not the Leader source itself) so both Aura (no controller
      // filter) and Leader (friendly-only) apply to it.
      target = makeUnit({ ownerId: p.active, strength: 5, injured: true });
      d.grid[0][0].location = auraLocation;
      d.grid[0][0].units.push(leaderSource, target);
    });
    const { queries } = rebuildListeners(state);
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

    const breakdown = getModifiedStatWithSources(state, queries, target, "strength", { row: 0, col: 0 }, ctx);
    expect(breakdown.base).toBe(5);
    expect(breakdown.modifiers).toHaveLength(3); // Aura, Leader, injured — each a distinct source
    // Keyed on cardId, not definitionId: makeUnit gives both the Leader source
    // and the target `definitionId: "test-unit"`, so a definitionId assertion
    // can't tell "the Leader contributed" from "some other test-unit did".
    const cardIds = breakdown.modifiers.map((m) => m.source.cardId).sort();
    expect(cardIds).toEqual([auraLocation.id, leaderSource.id, target.id].sort());
    expect(breakdown.final).toBe(2); // 5 - 1 (Aura) - 1 (Leader) - 1 (injury)
  });

  it("a stat driven below 0 clamps `final` at 0 while `base`/`modifiers` still report the raw math", () => {
    let target!: UnitCard;
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active, keywords: ["Aura:-1:all:contest"] });
      target = makeUnit({ ownerId: p.other, strength: 0 });
    });
    const { queries } = rebuildListeners(state);
    const ctx = { contest: { role: "attacker" as const, row: 0, col: 0 } };

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
  it("discounts buy and deploy for a sharing card, not a non-sharing card, floors at 0", () => {
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

  it("attribute matching is case-insensitive, and a card with no attributes never matches", () => {
    // Patron goes through `sharesAttribute`, a different helper from the
    // `hasAttribute` path Kindred uses — so Kindred's case-insensitivity test
    // says nothing about this one. The no-attributes case is real: the reminder
    // says "cards you buy", and locations and items carry no attributes.
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Patron:1"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const lowercase = makeUnit({
      ownerId: active, cost: "3", attributes: ["military" as unknown as Attribute],
    });
    const attributeless = makeLocation({ ownerId: active, cost: "3" });

    expect(getModifiedCost(state, queries, lowercase, active, "buy")).toBe(2);
    expect(getModifiedCost(state, queries, attributeless, active, "buy")).toBe(3);
  });

  it("a full applyAction(buy) actually deducts the discounted gold", () => {
    // Squire got this regression guard for AP; Patron's gold equivalent was
    // only ever asserted at the getModifiedCost layer, so a `buy` handler that
    // ignored the modifier would have gone unnoticed.
    let card!: UnitCard;
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, attributes: ["Military"], keywords: ["Patron:1"] }),
      );
      card = makeUnit({ ownerId: p.active, cost: "3", attributes: ["Military"] });
      d.market = [card];
      d.players[p.activeIdx].gold = 10;
    });
    const { active, activeIdx } = getPlayers(state);

    const { state: next } = applyAction(state, { type: "buy", playerId: active, cardId: card.id });
    // Base 3, Patron -1 => 2 gold spent, not 3.
    expect((next as MainGameState).players[activeIdx].gold).toBe(8);
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

  it("getValidActions offers equip at AP 0 only because Squire made it free", () => {
    // The outer `if (ap >= 1)` gate on the equip block was replaced by a
    // per-candidate `ap >= apCost` check. Asserting only the positive would
    // pass even with no AP check at all, so both halves are pinned here:
    // free equip is offered (the Mary Shelley free-action precedent), a
    // 1-AP equip at 0 AP is not.
    const withSquire = gameWith((d, p) => {
      const unit = makeUnit({ ownerId: p.active });
      const item = makeItem({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(makeUnit({ ownerId: p.active, keywords: ["Squire"] }), unit, item);
      d.turn.actionPointsRemaining = 0;
    });
    const withoutSquire = gameWith((d, p) => {
      const unit = makeUnit({ ownerId: p.active });
      const item = makeItem({ ownerId: p.active });
      d.players[p.activeIdx].hq.push(unit, item);
      d.turn.actionPointsRemaining = 0;
    });

    expect(getValidActions(withSquire, getPlayers(withSquire).active)
      .some((a) => a.type === "equip")).toBe(true);
    expect(getValidActions(withoutSquire, getPlayers(withoutSquire).active)
      .some((a) => a.type === "equip")).toBe(false);
  });

  it("discounts transferring an item between units", () => {
    // Squire covers all three item actions (rules/README.md Actions).
    // Transfer is the one with the most moving parts — the item detaches and
    // re-attaches in a single action — so it is the one worth pinning here;
    // the unequip discount is covered in main-actions.test.ts alongside the
    // other unequip behaviour.
    let itemCard!: ItemCard, unitA!: UnitCard, unitB!: UnitCard;
    const state = gameWith((d, p) => {
      unitA = makeUnit({ ownerId: p.active });
      unitB = makeUnit({ ownerId: p.active });
      itemCard = makeItem({ ownerId: p.active, equippedTo: unitA.id });
      d.players[p.activeIdx].hq.push(
        makeUnit({ ownerId: p.active, keywords: ["Squire"] }), unitA, unitB, itemCard,
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const transfer: MainAction = { type: "transfer", playerId: active, itemId: itemCard.id, unitId: unitB.id };
    const apBefore = state.turn.actionPointsRemaining;

    expect(getModifiedAPCost(state, queries, transfer, 1)).toBe(0);
    const { state: next } = applyAction(state, transfer);
    expect((next as MainGameState).turn.actionPointsRemaining).toBe(apBefore);
    const moved = (next as MainGameState).players
      .flatMap((pl) => pl.hq).find((c) => c.id === itemCard.id) as ItemCard;
    expect(moved.equippedTo).toBe(unitB.id);
  });
});

describe("Heavy / Lightweight", () => {
  it("Heavy costs +1 AP, Lightweight -1 AP on the equipped unit's move; both together cancel", () => {
    // Items live on the grid alongside their bearer — the configuration a real
    // move happens in. The HQ-only fixtures these tests used to build left
    // rebuildListeners' grid-item keyword hook completely uncovered, and also
    // pointed `equippedTo` at a unit id no card in the game had.
    let bearer!: UnitCard;
    const state = gameWith((d, p) => {
      bearer = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: bearer.id, keywords: ["Heavy"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);
    const moveAction: MainAction = { type: "move", playerId: active, unitId: bearer.id, row: 0, col: 1 };

    expect(getModifiedAPCost(state, queries, moveAction, 1)).toBe(2);

    let bothBearer!: UnitCard;
    const bothState = gameWith((d, p) => {
      bothBearer = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(bothBearer);
      d.grid[0][0].items.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: bothBearer.id, keywords: ["Heavy"] }),
        makeItem({ ownerId: p.active, definitionId: "swift-boots", equippedTo: bothBearer.id, keywords: ["Lightweight"] }),
      );
    });
    const { queries: bothQueries } = rebuildListeners(bothState);
    const bothMove: MainAction = {
      type: "move", playerId: getPlayers(bothState).active, unitId: bothBearer.id, row: 0, col: 1,
    };
    expect(getModifiedAPCost(bothState, bothQueries, bothMove, 1)).toBe(1);
  });

  it("only taxes the bearer's move — not their equip, and not another action type", () => {
    // Squire has this negative control; Heavy/Lightweight did not, so deleting
    // the `ctx.action.type !== "move"` guard broke no test while silently
    // taxing every action the bearer took.
    let bearer!: UnitCard;
    const state = gameWith((d, p) => {
      bearer = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(
        makeItem({ ownerId: p.active, definitionId: "heavy-armor", equippedTo: bearer.id, keywords: ["Heavy"] }),
      );
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);

    const equipAction: MainAction = { type: "equip", playerId: active, itemId: "i-other", unitId: bearer.id };
    expect(getModifiedAPCost(state, queries, equipAction, 1)).toBe(1);
    const razeAction: MainAction = { type: "raze", playerId: active, unitId: bearer.id, row: 0, col: 0 };
    expect(getModifiedAPCost(state, queries, razeAction, 3)).toBe(3);
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
  it("turns an injure outcome into a kill and flags self-injury", () => {
    expect(applyBerserker("injure_defender", true, true)).toEqual({ outcome: "kill_defender", injureWinner: true });
    expect(applyBerserker("injure_attacker", false, true)).toEqual({ outcome: "kill_attacker", injureWinner: true });
  });

  it("still costs an injury when the win was already a kill", () => {
    // The old wording ("...and would injure the loser") exempted landslide
    // wins, so a berserker that overwhelmed its target paid nothing. That
    // counterfactual is gone: every win costs an injury, whatever the margin.
    expect(applyBerserker("kill_defender", true, true)).toEqual({ outcome: "kill_defender", injureWinner: true });
    expect(applyBerserker("kill_attacker", false, true)).toEqual({ outcome: "kill_attacker", injureWinner: true });
  });

  it("is the identity without Berserker", () => {
    expect(applyBerserker("injure_defender", true, false)).toEqual({ outcome: "injure_defender", injureWinner: false });
    expect(applyBerserker("kill_attacker", false, false)).toEqual({ outcome: "kill_attacker", injureWinner: false });
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

  it("an already-injured berserker dies to its own self-injury, and still takes the loser with it", () => {
    // Re-injury kills (rules/README.md Unit status) — the same rule the trap
    // and DSL injure paths apply. Without it an already-injured berserker
    // would be strictly better than a healthy one: every narrow win becomes a
    // free kill at no cost, inverting the keyword's whole drawback. Reachable
    // because round 0 rolls injured units too (`ignoreInjured: round === 0`).
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
    expect(unitKilled(events, attacker.id)).toBe(true);
    // Both leave the cell; the berserker goes to its owner's discard.
    expect((next as MainGameState).grid[0][0].units.map((u) => u.id)).toEqual([]);
  });

  it("an injured berserker dies even on a landslide — the margin no longer exempts it", () => {
    // Newly lethal: the old wording exempted 2x+ wins from self-injury, so an
    // injured berserker could keep overwhelming targets indefinitely. Now any
    // win injures, and injuring an already-injured unit kills it. The practical
    // shape of the card is "wins twice, then dies" unless healed at HQ.
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({
        ownerId: p.active, strength: LANDSLIDE.attacker, injured: true, keywords: ["Berserker"],
      });
      defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.defender });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(unitKilled(events, defender.id)).toBe(true);
    expect(unitKilled(events, attacker.id)).toBe(true);
  });

  it("a winning berserker DEFENDER upgrades and self-injures, same as an attacker", () => {
    // Every other Berserker/Loot integration case puts the keyword on the
    // attacking side, so nothing pinned that resolveCombatPair identifies a
    // winning defender as the winner — hardcoding `winner = atk` used to pass
    // the whole suite.
    let attacker!: UnitCard, defender!: UnitCard;
    const state = gameWith((d, p) => {
      // Roles inverted: the weak side declares the attack and loses.
      attacker = makeUnit({ ownerId: p.active, strength: NARROW_WIN.defender });
      defender = makeUnit({ ownerId: p.other, strength: NARROW_WIN.attacker, keywords: ["Berserker"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    const { events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    const pair = events.find((e) => e.type === "combat_pair_resolved");
    expect(pair && pair.type === "combat_pair_resolved" && pair.outcome).toBe("kill_attacker");
    expect(unitKilled(events, attacker.id)).toBe(true);
    expect(unitInjured(events, defender.id)).toBe(true);
  });

  it("winning by 2x+ still costs the berserker an injury", () => {
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
    // Under the old "would injure the loser" wording this was false — a
    // landslide was a free kill. The margin no longer matters.
    expect(unitInjured(events, attacker.id)).toBe(true);
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

  it("a winning Loot DEFENDER draws — for its own controller, not the acting player", () => {
    // resolveCombatPair picks the winner from either side; with Loot only ever
    // tested on attackers, a hardcoded `winner = atk` passed the whole suite.
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      // Inverted roles: the weak side declares the attack and dies.
      attacker = makeUnit({ ownerId: p.active, strength: LANDSLIDE.defender });
      const defender = makeUnit({ ownerId: p.other, strength: LANDSLIDE.attacker, keywords: ["Loot"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
      d.players[p.otherIdx].mainDeck.push(makeUnit({ ownerId: p.other }));
    });
    const { active, other } = getPlayers(state);
    const defenderHandBefore = state.players.find((pl) => pl.id === other)!.hand.length;
    const attackerHandBefore = state.players.find((pl) => pl.id === active)!.hand.length;

    const { state: next, events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    expect(cardDrawn(events)).toBe(true);
    const players = (next as MainGameState).players;
    expect(players.find((pl) => pl.id === other)!.hand.length).toBe(defenderHandBefore + 1);
    expect(players.find((pl) => pl.id === active)!.hand.length).toBe(attackerHandBefore);
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
    // Asserting the message, not just "it throws" — a bare .toThrow() also
    // passes on an unrelated KeywordError from the fixture.
    expect(() => applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 }))
      .toThrow(/shielded by Untouchable/);
  });

  it("shields on strictly exceeding — an equal stat leaves the defender targetable", () => {
    // Both the reminder and the rules say "exceeds", so equality must NOT
    // shield. Every other fixture uses a clear gap, which left `>` vs `>=`
    // indistinguishable.
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, charisma: 9 });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    expect(getValidActions(state, active).some((a) => a.type === "attack")).toBe(true);
    expect(() => applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 }))
      .not.toThrow();
  });

  it("reads the defender's own stat under the defender role, so a :def buff can raise the shield", () => {
    // The Leader:+10 test above pins only the attacker-side read. Without this,
    // flipping the defender's own query to `role: "attacker"` changed nothing
    // in the suite — while silently dropping every `context:contest:def` buff
    // on the shielded unit.
    let attacker!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, charisma: 8 });
      const defender = makeUnit({
        ownerId: p.other, charisma: 5,
        keywords: ["Untouchable:charisma", "Prowess:+6:charisma:contest:def"],
      });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, defender);
    });
    const { active } = getPlayers(state);

    // Base 5 loses to 8; 5 + 6 (def-role Prowess) = 11 shields.
    expect(getValidActions(state, active).some((a) => a.type === "attack")).toBe(false);
  });

  it("two committed attackers both below the shield stat — the shield holds", () => {
    let a1!: UnitCard, a2!: UnitCard;
    const state = gameWith((d, p) => {
      a1 = makeUnit({ ownerId: p.active, charisma: 5 });
      a2 = makeUnit({ ownerId: p.active, charisma: 6 });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(a1, a2, defender);
    });
    const { active } = getPlayers(state);

    expect(getValidActions(state, active).some((a) => a.type === "attack")).toBe(false);
    expect(() => applyAction(state, {
      type: "attack", playerId: active, unitIds: [a1.id, a2.id], row: 0, col: 0,
    })).toThrow(/shielded by Untouchable/);
  });

  it("a hand-crafted subset attack cannot use a strong ally it did not commit", () => {
    // getValidActions offers all-units-at-the-cell, so the shield there is
    // evaluated against the whole stack. handleAttack evaluates against
    // `action.unitIds` only — committing just the weak attacker must be
    // rejected even though a strong ally is standing right there.
    let weak!: UnitCard, strong!: UnitCard;
    const state = gameWith((d, p) => {
      weak = makeUnit({ ownerId: p.active, charisma: 5 });
      strong = makeUnit({ ownerId: p.active, charisma: 20 });
      const defender = makeUnit({ ownerId: p.other, charisma: 9, keywords: ["Untouchable:charisma"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(weak, strong, defender);
    });
    const { active } = getPlayers(state);

    expect(() => applyAction(state, { type: "attack", playerId: active, unitIds: [weak.id], row: 0, col: 0 }))
      .toThrow(/shielded by Untouchable/);
    expect(() => applyAction(state, {
      type: "attack", playerId: active, unitIds: [weak.id, strong.id], row: 0, col: 0,
    })).not.toThrow();
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

  it("two committed attackers, one above and one below the shield stat — attack legal, defender targetable", () => {
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
    const { state: next, events } = applyAction(state, { type: "attack", playerId: active, unitIds: [attacker.id], row: 0, col: 0 });
    // combat_started names the defender that was actually engaged. Asserting
    // only that the shielded unit survived unharmed would pass just as well if
    // it HAD been targeted and won its roll.
    const started = events.find((e) => e.type === "combat_started");
    expect(started && started.type === "combat_started" && started.defenderId).not.toBe(shielded.id);
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

    // Untouchable is never registered as a ProtectionListener — it needs the
    // whole committed-attacker list, which a per-unit protection query can't
    // supply. So DSL contests and event targeting see the unit exactly as if
    // it had no protection at all.
    expect(isUnitProtected(state, queries, defender, { row: 0, col: 0 }, "contest_target", "charisma")).toBe(false);
    expect(isUnitProtected(state, queries, defender, { row: 0, col: 0 }, "event_target")).toBe(false);
  });
});

describe("item keywords stop contributing once the item is put down", () => {
  // Heavy, Lightweight and Flying all gate on `equippedTo`, so unequipping has
  // to silence them. Before the unequip action existed the only way to reach
  // this state was the bearer being killed — which also removes the unit, so
  // the "same unit, item now loose" case was never exercised.

  it("Heavy stops taxing the former bearer's move", () => {
    let bearer!: UnitCard, anvil!: ItemCard;
    const state = gameWith((d, p) => {
      bearer = makeUnit({ ownerId: p.active });
      anvil = makeItem({ ownerId: p.active, equippedTo: bearer.id, keywords: ["Heavy"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(anvil);
    });
    const { active } = getPlayers(state);
    const move: MainAction = { type: "move", playerId: active, unitId: bearer.id, row: 0, col: 1 };

    expect(getModifiedAPCost(state, rebuildListeners(state).queries, move, 1)).toBe(2);

    const next = applyAction(state, { type: "unequip", playerId: active, itemId: anvil.id })
      .state as MainGameState;
    expect(getModifiedAPCost(next, rebuildListeners(next).queries, move, 1)).toBe(1);
  });

  it("Lightweight stops discounting the former bearer's move", () => {
    let bearer!: UnitCard, boots!: ItemCard;
    const state = gameWith((d, p) => {
      bearer = makeUnit({ ownerId: p.active });
      boots = makeItem({ ownerId: p.active, equippedTo: bearer.id, keywords: ["Lightweight"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(bearer);
      d.grid[0][0].items.push(boots);
    });
    const { active } = getPlayers(state);
    const move: MainAction = { type: "move", playerId: active, unitId: bearer.id, row: 0, col: 1 };

    expect(getModifiedAPCost(state, rebuildListeners(state).queries, move, 1)).toBe(0);

    const next = applyAction(state, { type: "unequip", playerId: active, itemId: boots.id })
      .state as MainGameState;
    expect(getModifiedAPCost(next, rebuildListeners(next).queries, move, 1)).toBe(1);
  });

  it("Flying stops bypassing a blocked edge", () => {
    // Mirrors the equipped-case fixture below: grid[0][0]'s east edge and
    // grid[0][1]'s west edge are both blocked, so the move is legal only while
    // the Flying item is borne.
    let unit!: UnitCard, wings!: ItemCard;
    const state = gameWith((d, p) => {
      unit = makeUnit({ ownerId: p.active });
      wings = makeItem({ ownerId: p.active, equippedTo: unit.id, keywords: ["Flying"] });
      d.grid[0][0].location = makeLocation({ ownerId: p.active, edges: { n: true, e: false, s: true, w: true } });
      d.grid[0][1].location = makeLocation({ ownerId: p.active, edges: { n: true, e: true, s: true, w: false } });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(wings);
    });
    const { active } = getPlayers(state);
    const crossesBlockedEdge = (s: MainGameState): boolean =>
      getValidActions(s, active).some((a) => a.type === "move" && a.unitId === unit.id && a.row === 0 && a.col === 1);

    expect(crossesBlockedEdge(state)).toBe(true);

    const next = applyAction(state, { type: "unequip", playerId: active, itemId: wings.id })
      .state as MainGameState;
    expect(crossesBlockedEdge(next)).toBe(false);
    expect(() => applyAction(next, { type: "move", playerId: active, unitId: unit.id, row: 0, col: 1 }))
      .toThrow();
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
      // grid[0][1] has no location at all; grid[1][1] has one but is diagonal.
      d.grid[1][1].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(unit);
      d.grid[0][0].items.push(makeItem({ ownerId: p.active, equippedTo: unit.id, keywords: ["Flying"] }));
    });
    const { active } = getPlayers(state);

    const actions = getValidActions(state, active);
    // No location at the destination.
    expect(actions.some((a) => a.type === "move" && a.unitId === unit.id && a.row === 0 && a.col === 1)).toBe(false);
    // Has a location, but is not orthogonally adjacent — Flying bypasses the
    // edge check only, never the adjacency rule.
    expect(actions.some((a) => a.type === "move" && a.unitId === unit.id && a.row === 1 && a.col === 1)).toBe(false);
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

describe("cards carrying more than one keyword", () => {
  // alpha-1 already ships these shapes: mansa-musa is
  // `Untouchable:charisma;Patron:1` and genghis-khan is
  // `Leader:+1:all:contest;Loot`. Every other fixture in this file has exactly
  // one token, so restricting keywordEffects' loop to the first broke nothing.
  it("a direct-hook token and a resolver token on one unit both take effect", () => {
    let attacker!: UnitCard, patronSource!: UnitCard;
    const state = gameWith((d, p) => {
      attacker = makeUnit({ ownerId: p.active, charisma: 5 });
      patronSource = makeUnit({
        ownerId: p.other, charisma: 9, attributes: ["Military"],
        keywords: ["Untouchable:charisma", "Patron:1"],
      });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(attacker, patronSource);
    });
    const { active, other } = getPlayers(state);
    const { queries } = rebuildListeners(state);

    // Untouchable (direct hook) shields it...
    expect(getValidActions(state, active).some((a) => a.type === "attack")).toBe(false);
    // ...and Patron (switch case) still discounts for its own controller.
    const card = makeUnit({ ownerId: other, cost: "3", attributes: ["Military"] });
    expect(getModifiedCost(state, queries, card, other, "buy")).toBe(2);
  });

  it("two resolver tokens on one unit both register their queries", () => {
    let source!: UnitCard, friendly!: UnitCard;
    const state = gameWith((d, p) => {
      source = makeUnit({ ownerId: p.active, keywords: ["Leader:+1:all:contest", "Squire"] });
      friendly = makeUnit({ ownerId: p.active, strength: 5 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(source, friendly);
    });
    const { active } = getPlayers(state);
    const { queries } = rebuildListeners(state);

    expect(getModifiedStat(state, queries, friendly, "strength", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(6);
    const equipAction: MainAction = { type: "equip", playerId: active, itemId: "i1", unitId: "u1" };
    expect(getModifiedAPCost(state, queries, equipAction, 1)).toBe(0);
  });
});

describe("keywords in a DSL stat contest", () => {
  it("a contest-context keyword applies to executeContest, not just the Attack action", () => {
    // StatQueryContext.contest is set by both the Attack action and the DSL's
    // executeContest — that shared occasion is the whole reason the grammar's
    // `combat` value was renamed to `contest`. Live on real cards:
    // miyamoto-musashi carries Prowess:+2:strength:contest:atk alongside a
    // `duel:1:contest.strength(enemy)` action.
    let actor!: UnitCard, target!: UnitCard;
    const state = gameWith((d, p) => {
      actor = makeUnit({
        ownerId: p.active, strength: 5,
        keywords: ["Prowess:+4:strength:contest:atk"],
        actions: [{ name: "duel", apCost: 1, effect: "contest.strength(enemy)" }],
      });
      target = makeUnit({ ownerId: p.other, strength: 6 });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(actor, target);
    });
    const { queries } = rebuildListeners(state);

    // The acting side is read under the attacker role, so the :atk token lands.
    expect(getModifiedStat(state, queries, actor, "strength", { row: 0, col: 0 },
      { contest: { role: "attacker", row: 0, col: 0 } })).toBe(9);
    // The target is read under the defender role, so it does not.
    expect(getModifiedStat(state, queries, actor, "strength", { row: 0, col: 0 },
      { contest: { role: "defender", row: 0, col: 0 } })).toBe(5);
    expect(getModifiedStat(state, queries, target, "strength", { row: 0, col: 0 },
      { contest: { role: "defender", row: 0, col: 0 } })).toBe(6);
  });
});

describe("bad data at runtime", () => {
  it("a malformed keyword token throws KeywordError naming the card and the token", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({
        ownerId: p.active, definitionId: "bad-card",
        keywords: ["Prowess:not-a-number:strength:contest"],
      }));
    });

    expect(() => rebuildListeners(state)).toThrow(KeywordError);
    // The card, not just the keyword: rebuildListeners runs on every state
    // read, so without the definitionId an operator has only a CSV grep.
    expect(() => rebuildListeners(state)).toThrow(/bad-card/);
    expect(() => rebuildListeners(state)).toThrow(/Prowess:not-a-number:strength:contest/);
  });

  it("the throw reaches the public API — one bad token bricks the whole game", () => {
    // The blast radius is the reason a build-time gate matters (see
    // test/build.test.ts): both entry points call rebuildListeners, so a
    // single malformed token makes every action of the game fail, not just
    // the card that carries it.
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, keywords: ["Prowess:not-a-number:strength:contest"] }));
    });
    const { active } = getPlayers(state);

    expect(() => getValidActions(state, active)).toThrow(KeywordError);
    expect(() => applyAction(state, { type: "pass", playerId: active })).toThrow(KeywordError);
  });
});
