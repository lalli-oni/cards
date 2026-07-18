import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import type { Action, EndedGameState, MainGameState } from "../types";
import { getActivePlayerId } from "../types";
import { getValidActions, inferActivateTargets } from "../valid-actions";
import type { BoardPosition } from "../position-helpers";
import {
  createSeedingGame,
  createTestGame,
  makeInstantEvent,
  makeLocation,
  makePassiveEvent,
  makeTrapEvent,
  makeUnit,
} from "./helpers";

describe("getValidActions", () => {
  describe("main phase", () => {
    it("always includes pass for the active player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, state.turn.activePlayerId);
      const types = actions.map((a) => a.type);
      expect(types).toContain("pass");
      // draw requires cards in deck or discard — empty by default
      expect(types).not.toContain("draw");
      expect(actions[0].playerId).toBe(state.turn.activePlayerId);
    });

    it("returns empty array for non-active player", () => {
      const state = createTestGame();
      // biome-ignore lint/style/noNonNullAssertion: 2-player game always has a non-active player
      const nonActive = state.players.map((p) => p.id).find(
        (id) => id !== state.turn.activePlayerId,
      )!;
      const actions = getValidActions(state, nonActive);
      expect(actions).toEqual([]);
    });

    it("returns empty array when game has ended", () => {
      const base = createTestGame();
      const endedState: EndedGameState = {
        ...base,
        phase: "ended",
        scores: {},
        pickPrompt: undefined,
        viewPrompt: undefined,
        combatPrompt: undefined,
      };
      const actions = getValidActions(
        endedState,
        endedState.turn.activePlayerId,
      );
      expect(actions).toEqual([]);
    });

    it("returns empty array for unknown player", () => {
      const state = createTestGame();
      const actions = getValidActions(state, "nonexistent");
      expect(actions).toEqual([]);
    });
  });

  describe("getActivePlayerId", () => {
    it("returns activePlayerId for main phase", () => {
      const state = createTestGame();
      expect(getActivePlayerId(state)).toBe(state.turn.activePlayerId);
    });

    it("returns currentPlayerId for seeding phase", () => {
      const state = createSeedingGame();
      expect(getActivePlayerId(state)).toBe(state.seedingState.currentPlayerId);
    });

    it("throws for ended phase", () => {
      const base = createTestGame();
      const endedState: EndedGameState = {
        ...base,
        phase: "ended",
        scores: {},
        pickPrompt: undefined,
        viewPrompt: undefined,
        combatPrompt: undefined,
      };
      expect(() => getActivePlayerId(endedState)).toThrow(
        "No active player in ended phase",
      );
    });
  });

  describe("seeding phase", () => {
    it("returns seed_draw at seed_draw step", () => {
      const state = createSeedingGame();
      const activeId = state.seedingState.currentPlayerId;
      const actions = getValidActions(state, activeId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_draw");
    });

    it("returns seed_keep at seed_keep step", () => {
      const state = produce(createSeedingGame(), (draft) => {
        draft.seedingState.step = "seed_keep";
      });
      const activeId = state.seedingState.currentPlayerId;
      const actions = getValidActions(state, activeId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_keep");
    });
  });
});

describe("inferActivateTargets — HQ origin", () => {
  function setup(opts: { effect: string; deckTopUp?: number } = { effect: "gold[1]" }) {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const unit = makeUnit({
      ownerId: activeId,
      actions: [{ name: "act", apCost: 1, effect: opts.effect }],
    });
    const state = produce(base, (d) => {
      d.players.find((p) => p.id === activeId)!.hq.push(unit);
      if (opts.deckTopUp) {
        const top = d.players.find((p) => p.id === activeId)!;
        for (let i = 0; i < opts.deckTopUp; i++) {
          top.mainDeck.push(makeUnit({ ownerId: activeId, name: `Top${i}` }));
        }
      }
    });
    const hq: BoardPosition = { type: "hq", playerId: activeId };
    return { state: state as MainGameState, unit, activeId, hq };
  }

  it("allows gold[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "gold[1]" });
    expect(inferActivateTargets(state, unit.id, "gold[1]", hq, activeId)).toEqual([{}]);
  });

  it("allows vp[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "vp[1]" });
    expect(inferActivateTargets(state, unit.id, "vp[1]", hq, activeId)).toEqual([{}]);
  });

  it("allows buy(item)[0] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "buy(item)[0]" });
    expect(inferActivateTargets(state, unit.id, "buy(item)[0]", hq, activeId)).toEqual([{}]);
  });

  it("allows peek(deck)[3] > pick[1] when deck has cards", () => {
    const { state, unit, activeId, hq } = setup({
      effect: "peek(deck)[3] > pick[1]",
      deckTopUp: 3,
    });
    expect(
      inferActivateTargets(state, unit.id, "peek(deck)[3] > pick[1]", hq, activeId),
    ).toEqual([{}]);
  });

  it("rejects peek(deck)[3] > pick[1] when deck is empty (precondition gate)", () => {
    const { state, unit, activeId, hq } = setup({ effect: "peek(deck)[3] > pick[1]" });
    expect(
      inferActivateTargets(state, unit.id, "peek(deck)[3] > pick[1]", hq, activeId),
    ).toEqual([]);
  });

  it("rejects kill(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "kill(self)" });
    expect(inferActivateTargets(state, unit.id, "kill(self)", hq, activeId)).toEqual([]);
  });

  it("rejects move(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "move(self)" });
    expect(inferActivateTargets(state, unit.id, "move(self)", hq, activeId)).toEqual([]);
  });

  it("rejects compound vp[1] + kill(self) from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "vp[1] + kill(self)" });
    expect(
      inferActivateTargets(state, unit.id, "vp[1] + kill(self)", hq, activeId),
    ).toEqual([]);
  });

  it("rejects compound move(self) + gold[1] from HQ", () => {
    const { state, unit, activeId, hq } = setup({ effect: "move(self) + gold[1]" });
    expect(
      inferActivateTargets(state, unit.id, "move(self) + gold[1]", hq, activeId),
    ).toEqual([]);
  });
});

describe("play_event enumeration", () => {
  function activeIdxOf(state: MainGameState): number {
    return state.players.findIndex((p) => p.id === state.turn.activePlayerId);
  }

  function playEventActions(state: MainGameState): Extract<Action, { type: "play_event" }>[] {
    return getValidActions(state, state.turn.activePlayerId)
      .filter((a): a is Extract<Action, { type: "play_event" }> => a.type === "play_event");
  }

  const LOCATION_TARGETING_TRAPS = [
    { definitionId: "highway-robbery", label: "Highway Robbery" },
    { definitionId: "sprung-trap", label: "Sprung Trap" },
    { definitionId: "assassination-attempt", label: "Assassination Attempt" },
  ] as const;

  for (const { definitionId, label } of LOCATION_TARGETING_TRAPS) {
    it(`${label}: emits one candidate per location-bearing cell with matching targetId`, () => {
      const base = createTestGame();
      const activeId = base.turn.activePlayerId;
      const loc1 = makeLocation({ ownerId: activeId });
      const loc2 = makeLocation({ ownerId: activeId });
      const trap = makeTrapEvent({
        ownerId: activeId,
        definitionId,
        trigger: "enemy_unit_enters_location",
        cost: "0",
      });
      const state = produce(base, (d) => {
        d.grid[0][0].location = loc1;
        d.grid[1][2].location = loc2;
        d.players[activeIdxOf(base)].hand.push(trap);
      });

      const candidates = playEventActions(state).filter((a) => a.cardId === trap.id);
      const targetIds = candidates.map((a) => a.targetId).sort();

      expect(candidates).toHaveLength(2);
      expect(targetIds).toEqual([loc1.id, loc2.id].sort());
      // Without this the player could play the trap with no target selected.
      expect(candidates.every((a) => a.targetId !== undefined)).toBe(true);
    });
  }

  it("Plague (passive): emits one candidate per location-bearing cell with matching targetId", () => {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const loc1 = makeLocation({ ownerId: activeId });
    const loc2 = makeLocation({ ownerId: activeId });
    const plague = makePassiveEvent({
      ownerId: activeId,
      definitionId: "plague",
      cost: "0",
      duration: 99,
    });
    const state = produce(base, (d) => {
      d.grid[0][0].location = loc1;
      d.grid[2][2].location = loc2;
      d.players[activeIdxOf(base)].hand.push(plague);
    });

    const candidates = playEventActions(state).filter((a) => a.cardId === plague.id);
    const targetIds = candidates.map((a) => a.targetId).sort();

    expect(candidates).toHaveLength(2);
    expect(targetIds).toEqual([loc1.id, loc2.id].sort());
    expect(candidates.every((a) => a.targetId !== undefined)).toBe(true);
  });

  it("location-targeting trap: zero candidates when the grid has no locations", () => {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const trap = makeTrapEvent({
      ownerId: activeId,
      definitionId: "highway-robbery",
      trigger: "enemy_unit_enters_location",
      cost: "0",
    });
    const state = produce(base, (d) => {
      d.players[activeIdxOf(base)].hand.push(trap);
    });

    expect(playEventActions(state).filter((a) => a.cardId === trap.id)).toHaveLength(0);
  });

  // definitionId NOT in PASSIVE_EVENTS_NEEDING_LOCATION_TARGET — sanity that
  // the non-targeting branch still emits one untargeted candidate.
  it("passive not in the location-target registry: single untargeted candidate", () => {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const passive = makePassiveEvent({
      ownerId: activeId,
      definitionId: "arms-race",
      cost: "0",
      duration: 2,
    });
    const state = produce(base, (d) => {
      d.grid[0][0].location = makeLocation({ ownerId: activeId });
      d.grid[1][1].location = makeLocation({ ownerId: activeId });
      d.players[activeIdxOf(base)].hand.push(passive);
    });

    const candidates = playEventActions(state).filter((a) => a.cardId === passive.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetId).toBeUndefined();
  });

  it("instant event with no location targeting: single untargeted candidate", () => {
    const base = createTestGame();
    const activeId = base.turn.activePlayerId;
    const instant = makeInstantEvent({
      ownerId: activeId,
      definitionId: "harvest-festival",
      cost: "0",
    });
    const state = produce(base, (d) => {
      d.grid[0][0].location = makeLocation({ ownerId: activeId });
      d.players[activeIdxOf(base)].hand.push(instant);
    });

    const candidates = playEventActions(state).filter((a) => a.cardId === instant.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetId).toBeUndefined();
  });
});
