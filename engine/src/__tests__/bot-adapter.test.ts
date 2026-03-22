import { describe, expect, it } from "bun:test";
import { BotAdapter } from "../bot-adapter";
import type { Action, VisibleState } from "../types";
import { getVisibleState } from "../visible-state";
import { createTestGame } from "./helpers";

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
    await expect(bot.chooseAction(vis, [])).rejects.toThrow("no valid actions");
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
