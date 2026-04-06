import { describe, it, expect, beforeEach } from "bun:test";
import { produce, type Draft } from "immer";
import prand from "pure-rand";
import { parse, type Expression } from "../effect-dsl";
import { executeEffect, type ExecutionContext } from "../effect-dsl/executor";
import type { MainGameState, GameEvent } from "../types";
import { rebuildListeners } from "../listeners/rebuild";
import {
  createTestGame,
  makeUnit,
  makeLocation,
  resetIds,
} from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlayers(state: MainGameState) {
  const active = state.turn.activePlayerId;
  const other = state.players.find((p) => p.id !== active)!.id;
  const activeIdx = state.players.findIndex((p) => p.id === active);
  const otherIdx = state.players.findIndex((p) => p.id === other);
  return { active, other, activeIdx, otherIdx };
}

function gameWith(
  mutate: (d: Draft<MainGameState>, p: ReturnType<typeof getPlayers>) => void,
): MainGameState {
  const base = createTestGame();
  const players = getPlayers(base);
  return produce(base, (d) => mutate(d, players));
}

/** Run a DSL effect on a game state and return the updated state + events. */
function runEffect(
  state: MainGameState,
  effectStr: string,
  overrides?: Partial<ExecutionContext>,
) {
  const events: GameEvent[] = [];
  const { active, activeIdx } = getPlayers(state);
  const { queries } = rebuildListeners(state);

  const nextState = produce(state, (draft) => {
    const rng = prand.mersenne.fromState(draft.rngState);
    const ctx: ExecutionContext = {
      draft,
      playerId: active,
      emit: (e) => { events.push(e); },
      events,
      queries,
      rng,
      ...overrides,
    };
    const result = executeEffect(effectStr, ctx);
    draft.rngState = (result.rng.getState?.() ?? draft.rngState) as number[];
  });

  return { state: nextState as MainGameState, events, activeIdx };
}

beforeEach(() => resetIds());

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe("Effect DSL parser", () => {
  it("parses simple verb with value", () => {
    const ast = parse("gold[3]");
    expect(ast).toHaveLength(1); // one compound member
    expect(ast[0]).toHaveLength(1); // one step in chain
    expect(ast[0][0].primitive.verb).toBe("gold");
    expect(ast[0][0].primitive.value).toBe(3);
  });

  it("parses negative values", () => {
    const ast = parse("gold[-2]");
    expect(ast[0][0].primitive.value).toBe(-2);
  });

  it("parses dotted verb", () => {
    const ast = parse("contest.strength(enemy)");
    expect(ast[0][0].primitive.verb).toBe("contest");
    expect(ast[0][0].primitive.subVerb).toBe("strength");
  });

  it("parses compound targets with +", () => {
    const ast = parse("buff.strength(all + friendly)[2]~turn");
    const target = ast[0][0].primitive.target!;
    expect(target.tokens).toHaveLength(2);
    expect(target.tokens[0].name).toBe("all");
    expect(target.tokens[1].name).toBe("friendly");
  });

  it("parses target count inside parens", () => {
    const ast = parse("move(friendly[2])");
    const target = ast[0][0].primitive.target!;
    expect(target.tokens[0].name).toBe("friendly");
    expect(target.tokens[0].count).toBe(2);
  });

  it("parses modifiers", () => {
    const ast = parse("move(friendly)~ignore_blocked");
    expect(ast[0][0].primitive.modifiers).toEqual(["ignore_blocked"]);
  });

  it("parses compound effects with +", () => {
    const ast = parse("move(self) + gold[1]");
    expect(ast).toHaveLength(2);
    expect(ast[0][0].primitive.verb).toBe("move");
    expect(ast[1][0].primitive.verb).toBe("gold");
  });

  it("parses chain with >", () => {
    const ast = parse("reveal(deck)[3] > pick[1]");
    expect(ast).toHaveLength(1);
    expect(ast[0]).toHaveLength(2);
    expect(ast[0][0].primitive.verb).toBe("reveal");
    expect(ast[0][1].primitive.verb).toBe("pick");
  });

  it("parses contest with win consequence", () => {
    const ast = parse("contest.charisma(enemy + adjacent) > control(target)~round");
    expect(ast[0]).toHaveLength(1); // single step (contest with consequence)
    const step = ast[0][0];
    expect(step.primitive.verb).toBe("contest");
    expect(step.consequence).toBeDefined();
    expect(step.consequence!.winEffect[0].primitive.verb).toBe("control");
  });

  it("parses contest with ternary win:lose", () => {
    const ast = parse("contest.strength(enemy)[3] > gold[3] : gold[-2]");
    const step = ast[0][0];
    expect(step.consequence).toBeDefined();
    expect(step.consequence!.winEffect[0].primitive.verb).toBe("gold");
    expect(step.consequence!.winEffect[0].primitive.value).toBe(3);
    expect(step.consequence!.loseEffect).toBeDefined();
    expect(step.consequence!.loseEffect![0].primitive.value).toBe(-2);
  });

  it("rejects invalid input", () => {
    expect(() => parse("!!!")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Executor tests — simple verbs
// ---------------------------------------------------------------------------

describe("Effect DSL executor", () => {
  it("gold[3]: adds 3 gold to active player", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].gold = 5;
    });
    const { state: next, activeIdx, events } = runEffect(state, "gold[3]");
    expect(next.players[activeIdx].gold).toBe(8);
    expect(events.some((e) => e.type === "gold_changed")).toBe(true);
  });

  it("gold[-2]: removes 2 gold from active player", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].gold = 5;
    });
    const { state: next, activeIdx } = runEffect(state, "gold[-2]");
    expect(next.players[activeIdx].gold).toBe(3);
  });

  it("vp[1]: adds 1 VP to active player", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].vp = 0;
    });
    const { state: next, activeIdx } = runEffect(state, "vp[1]");
    expect(next.players[activeIdx].vp).toBe(1);
  });

  it("draw[2]: draws 2 cards from deck to hand", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].mainDeck.push(
        makeUnit({ ownerId: p.active }),
        makeUnit({ ownerId: p.active }),
        makeUnit({ ownerId: p.active }),
      );
      d.players[p.activeIdx].hand = [];
    });
    const { state: next, activeIdx } = runEffect(state, "draw[2]");
    expect(next.players[activeIdx].hand).toHaveLength(2);
    expect(next.players[activeIdx].mainDeck).toHaveLength(1);
  });

  it("kill(self): kills the acting unit", () => {
    const state = gameWith((d, p) => {
      const unit = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(unit);
    });
    const unit = state.grid[0][0].units[0];
    const { state: next, events } = runEffect(state, "kill(self)", {
      actingUnitId: unit.id,
      position: { row: 0, col: 0 },
    });
    expect(next.grid[0][0].units).toHaveLength(0);
    expect(events.some((e) => e.type === "unit_killed")).toBe(true);
  });

  it("injure(enemy): injures target enemy unit", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active }));
      d.grid[0][0].units.push(makeUnit({ ownerId: p.other }));
    });
    const actingUnit = state.grid[0][0].units[0];
    const enemyUnit = state.grid[0][0].units[1];
    const { state: next, events } = runEffect(state, "injure(enemy)", {
      actingUnitId: actingUnit.id,
      targetId: enemyUnit.id,
      position: { row: 0, col: 0 },
    });
    const injured = next.grid[0][0].units.find((u) => u.id === enemyUnit.id);
    expect(injured?.injured).toBe(true);
    expect(events.some((e) => e.type === "unit_injured")).toBe(true);
  });

  it("compound: vp[1] + kill(self)", () => {
    const state = gameWith((d, p) => {
      d.players[p.activeIdx].vp = 0;
      const unit = makeUnit({ ownerId: p.active });
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(unit);
    });
    const unit = state.grid[0][0].units[0];
    const { state: next, activeIdx, events } = runEffect(state, "vp[1] + kill(self)", {
      actingUnitId: unit.id,
      position: { row: 0, col: 0 },
    });
    expect(next.players[activeIdx].vp).toBe(1);
    expect(next.grid[0][0].units).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Executor — buffs
// ---------------------------------------------------------------------------

describe("Effect DSL executor — buffs", () => {
  it("buff.strength(all + friendly)[2]~turn: applies stat modifier to all friendly units", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, strength: 5 }));
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, strength: 3 }));
      d.grid[0][0].units.push(makeUnit({ ownerId: p.other, strength: 5 }));
    });
    const actingUnit = state.grid[0][0].units[0];
    const { state: next, events } = runEffect(
      state,
      "buff.strength(all + friendly)[2]~turn",
      { actingUnitId: actingUnit.id, position: { row: 0, col: 0 } },
    );
    // Both friendly units should have the modifier
    const friendlyUnits = next.grid[0][0].units.filter(
      (u) => u.ownerId === state.turn.activePlayerId,
    );
    for (const u of friendlyUnits) {
      expect(u.statModifiers).toBeDefined();
      expect(u.statModifiers!.some((m) => m.stat === "strength" && m.delta === 2)).toBe(true);
    }
    // Enemy unit should NOT have the modifier
    const enemyUnit = next.grid[0][0].units.find(
      (u) => u.ownerId !== state.turn.activePlayerId,
    );
    expect(enemyUnit?.statModifiers ?? []).toHaveLength(0);
    expect(events.filter((e) => e.type === "unit_buffed")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Executor — contests
// ---------------------------------------------------------------------------

describe("Effect DSL executor — contests", () => {
  it("contest.strength(enemy): resolves with default consequence (loser injured)", () => {
    const state = gameWith((d, p) => {
      d.grid[0][0].location = makeLocation({ ownerId: p.active });
      d.grid[0][0].units.push(makeUnit({ ownerId: p.active, strength: 10 }));
      d.grid[0][0].units.push(makeUnit({ ownerId: p.other, strength: 1 }));
    });
    const actingUnit = state.grid[0][0].units[0];
    const enemyUnit = state.grid[0][0].units[1];
    const { events } = runEffect(state, "contest.strength(enemy)", {
      actingUnitId: actingUnit.id,
      targetId: enemyUnit.id,
      position: { row: 0, col: 0 },
    });
    // With str 10 vs 1 + d6 each, the strong unit should almost certainly win
    // and the loser should be injured or killed
    expect(
      events.some((e) => e.type === "unit_injured" || e.type === "unit_killed"),
    ).toBe(true);
  });
});
