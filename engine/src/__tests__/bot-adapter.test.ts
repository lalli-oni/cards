import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import { BotAdapter } from "../bot-adapter";
import type { Action, VisibleState } from "../types";
import { getVisibleState } from "../visible-state";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import type { MainAction, MainGameState } from "../types";
import {
  createTestGame,
  expectRejects,
  makeItem,
  makeLocation,
  makeUnit,
} from "./helpers";

function makeVisibleState(): VisibleState {
  const state = createTestGame();
  return getVisibleState(state, state.turn.activePlayerId);
}

describe("BotAdapter", () => {
  it("picks an action from the valid set", async () => {
    const bot = new BotAdapter(42);
    const vis = makeVisibleState();
    const validActions: Action[] = [
      { type: "pass", playerId: "p1" },
      { type: "draw", playerId: "p1" },
    ];
    const chosen = await bot.chooseAction(vis, validActions);
    expect(validActions).toContainEqual(chosen);
  });

  it("throws when no valid actions available", async () => {
    const bot = new BotAdapter(42);
    const vis = makeVisibleState();
    await expectRejects(bot.chooseAction(vis, [])).toThrow("no valid actions");
  });

  it("is deterministic with the same seed", async () => {
    const validActions: Action[] = [
      { type: "pass", playerId: "p1" },
      { type: "draw", playerId: "p1" },
      { type: "deploy", playerId: "p1", cardId: "c1" },
    ];
    const vis = makeVisibleState();

    const bot1 = new BotAdapter(99);
    const bot2 = new BotAdapter(99);

    const choices1 = [];
    const choices2 = [];
    for (let i = 0; i < 10; i++) {
      choices1.push(await bot1.chooseAction(vis, validActions));
      choices2.push(await bot2.chooseAction(vis, validActions));
    }

    expect(choices1).toEqual(choices2);
  });

  it("does not always pick the same action", async () => {
    const bot = new BotAdapter(42);
    const vis = makeVisibleState();
    const validActions: Action[] = [
      { type: "pass", playerId: "p1" },
      { type: "draw", playerId: "p1" },
      { type: "deploy", playerId: "p1", cardId: "c1" },
    ];

    const types = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const action = await bot.chooseAction(vis, validActions);
      types.add(action.type);
    }

    // With 20 picks from 3 options, we should see more than 1 unique type
    expect(types.size).toBeGreaterThan(1);
  });
});

describe("BotAdapter greedy strategy", () => {
  function makeGreedyBot(seed = 42) {
    return new BotAdapter(seed, "greedy");
  }

  /** Build a VisibleState with a grid containing a mission location at (0,0). */
  function visWithMissionLocation(): VisibleState {
    const state = produce(createTestGame(), (d) => {
      d.grid[0][0].location = makeLocation({
        ownerId: "p1",
        requirements: "units_1",
        rewards: "3vp",
      });
    });
    return getVisibleState(state, state.turn.activePlayerId);
  }

  it("prioritises attempt_mission over all other actions", async () => {
    const bot = makeGreedyBot();
    const vis = makeVisibleState();
    const actions: Action[] = [
      { type: "pass", playerId: "p1" },
      { type: "draw", playerId: "p1" },
      { type: "enter", playerId: "p1", unitId: "u1", row: 0, col: 0 },
      { type: "attempt_mission", playerId: "p1", row: 0, col: 0 },
    ];

    const chosen = await bot.chooseAction(vis, actions);
    expect(chosen.type).toBe("attempt_mission");
  });

  it("prefers moves toward mission locations", async () => {
    const vis = visWithMissionLocation();
    const bot = makeGreedyBot();

    const actions: Action[] = [
      { type: "move", playerId: "p1", unitId: "u1", row: 0, col: 0 }, // mission location
      { type: "move", playerId: "p1", unitId: "u1", row: 1, col: 1 }, // empty cell
      { type: "pass", playerId: "p1" },
    ];

    // All picks should be the mission-location move (score 11 vs 0)
    for (let i = 0; i < 5; i++) {
      const chosen = await bot.chooseAction(vis, actions);
      expect(chosen.type).toBe("move");
      if (chosen.type === "move") {
        expect(chosen.row).toBe(0);
        expect(chosen.col).toBe(0);
      }
    }
  });

  it("prefers cells with friendly units for clustering", async () => {
    const state = produce(createTestGame(), (d) => {
      // Put friendly units at (1,1)
      d.grid[1][1].units.push(makeUnit({ ownerId: d.turn.activePlayerId }));
      d.grid[1][1].units.push(makeUnit({ ownerId: d.turn.activePlayerId }));
    });
    const vis = getVisibleState(state, state.turn.activePlayerId);
    const bot = makeGreedyBot();

    const actions: Action[] = [
      { type: "move", playerId: vis.playerId, unitId: "u1", row: 1, col: 1 }, // 2 friendlies → score 4
      { type: "move", playerId: vis.playerId, unitId: "u1", row: 2, col: 2 }, // empty → score 0
      { type: "pass", playerId: vis.playerId },
    ];

    const chosen = await bot.chooseAction(vis, actions);
    expect(chosen.type).toBe("move");
    if (chosen.type === "move") {
      expect(chosen.row).toBe(1);
      expect(chosen.col).toBe(1);
    }
  });

  it("excludes retreat moves from scoring", async () => {
    const vis = makeVisibleState();
    const bot = makeGreedyBot();

    // Only retreat moves available + pass
    const actions: Action[] = [
      { type: "move", playerId: "p1", unitId: "u1", row: -1, col: -1 },
      { type: "pass", playerId: "p1" },
    ];

    // With only retreat moves, scoreMoves returns empty, so bot falls through
    // to GREEDY_PRIORITY. No enter/deploy/etc. available, so it returns all actions.
    const chosen = await bot.chooseAction(vis, actions);
    // Should not crash; picks from remaining actions
    expect(["move", "pass"]).toContain(chosen.type);
  });

  it("falls through to priority list when no moves available", async () => {
    const vis = makeVisibleState();
    const bot = makeGreedyBot();

    const actions: Action[] = [
      { type: "deploy", playerId: "p1", cardId: "c1" },
      { type: "draw", playerId: "p1" },
      { type: "pass", playerId: "p1" },
    ];

    // deploy is higher priority than draw in GREEDY_PRIORITY
    const chosen = await bot.chooseAction(vis, actions);
    expect(chosen.type).toBe("deploy");
  });

  it("is deterministic with the same seed", async () => {
    const vis = visWithMissionLocation();
    const actions: Action[] = [
      { type: "move", playerId: "p1", unitId: "u1", row: 0, col: 0 },
      { type: "move", playerId: "p1", unitId: "u2", row: 0, col: 0 },
      { type: "enter", playerId: "p1", unitId: "u3", row: 1, col: 1 },
      { type: "pass", playerId: "p1" },
    ];

    const bot1 = makeGreedyBot(77);
    const bot2 = makeGreedyBot(77);

    const choices1 = [];
    const choices2 = [];
    for (let i = 0; i < 10; i++) {
      choices1.push(await bot1.chooseAction(vis, actions));
      choices2.push(await bot2.chooseAction(vis, actions));
    }

    expect(choices1).toEqual(choices2);
  });
});

describe("greedy strategy terminates on free item actions", () => {
  // The greedy strategy returns the first non-empty GREEDY_PRIORITY tier and
  // never falls through to `pass` while that tier has members. A `Squire`
  // discounts item actions to 0 AP, so a tier that can keep re-offering an item
  // action never drains and the game makes no progress. `run`'s
  // DEFAULT_MAX_ACTIONS budget eventually aborts it, but that is a circuit
  // breaker, not a diagnosis — it burns 10k actions and throws naming only the
  // phase, round and active player, so the livelock has to be caught here.
  //
  // This held before the equip/unequip/transfer split: `equip` was offered for
  // every (item, unit) pair where the unit wasn't the current bearer, so a
  // borne item kept offering equip to the *other* co-located unit and the tier
  // was self-sustaining. Two things close it now — `equip` only applies to a
  // loose item, so each one drains the tier; and re-attaching is `transfer`,
  // which is deliberately absent from GREEDY_PRIORITY.
  //
  // Adding "unequip" or "transfer" to GREEDY_PRIORITY would reopen it: an
  // unequip/equip pair oscillates the same way. This test is the guard.
  it("reaches pass with a Squire making every item action free", async () => {
    // Two co-located units, one item, a Squire, and nothing else available:
    // no hand, gold, decks or market, one location on an otherwise empty grid,
    // and its boundary edges closed so even the retreat-to-HQ move is gone.
    let state = produce(createTestGame(), (d: MainGameState) => {
      const pid = d.turn.activePlayerId;
      for (const pl of d.players) {
        pl.hand = []; pl.gold = 0;
        pl.mainDeck = []; pl.discardPile = []; pl.marketDeck = []; pl.prospectDeck = [];
      }
      d.market = [];
      for (const row of d.grid) {
        for (const cell of row) { cell.location = null; cell.units = []; cell.items = []; }
      }
      d.grid[0][0].location = makeLocation({
        ownerId: pid, edges: { n: false, e: true, s: true, w: false },
      });
      d.grid[0][0].units.push(
        makeUnit({ ownerId: pid }),
        makeUnit({ ownerId: pid }),
        makeUnit({ ownerId: pid, keywords: ["Squire"] }),
      );
      d.grid[0][0].items.push(makeItem({ ownerId: pid }));
    }) as MainGameState;

    const pid: string = state.turn.activePlayerId;
    const bot = new BotAdapter(42, "greedy");

    // Generous bound: the point is that it terminates at all, not how fast.
    for (let i = 0; i < 50; i++) {
      const actions = getValidActions(state, pid);
      const chosen = await bot.chooseAction(getVisibleState(state, pid), actions);
      if (chosen.type === "pass") return;
      // The fixture never leaves the main phase, so anything the bot can pick
      // here is a MainAction — chooseAction's return type spans every phase.
      state = applyAction(state, chosen as MainAction).state as MainGameState;
    }
    throw new Error("greedy strategy never offered pass — item action tier did not drain");
  });
});
