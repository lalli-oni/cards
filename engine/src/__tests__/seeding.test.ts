import { describe, expect, it, beforeEach } from "bun:test";
import { applyAction } from "../apply-action";
import { getValidActions } from "../valid-actions";
import { fillAction } from "../action-helpers";
import type { GameState, SeedingAction } from "../types";
import {
  createSeedingGame,
  resetIds,
  DEFAULT_CONFIG,
} from "./helpers";

beforeEach(() => resetIds());

function apply(state: GameState, action: SeedingAction): GameState {
  return applyAction(state, action).state;
}

function firstAction(state: GameState, type: string): SeedingAction {
  const actions = getValidActions(state, state.turn.activePlayerId);
  const found = actions.find((a) => a.type === type);
  if (!found) throw new Error(`No valid action of type "${type}" found`);
  return found as SeedingAction;
}

function drawAllPlayers(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < s.players.length; i++) {
    s = apply(s, firstAction(s, "seed_draw"));
  }
  return s;
}

/** Submit seed_keep for all players using fillAction to pick defaults. */
function keepAllPlayers(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < s.players.length; i++) {
    s = apply(s, fillAction(s, firstAction(s, "seed_keep")) as SeedingAction);
  }
  return s;
}

/** Find a steal action targeting a non-location card (avoids grid placement). */
function findNonLocationSteal(state: GameState, actions: SeedingAction[]): SeedingAction | undefined {
  const middle = state.seedingState!.middleArea;
  return actions.find((a) => {
    if (a.type !== "seed_steal") return false;
    const card = middle.find((c) => c.id === (a as any).cardId);
    return card?.type !== "location";
  });
}

/**
 * Play through the entire seeding phase by picking valid actions.
 * Uses fillAction to complete template actions with real card IDs.
 * Returns the final state (should be in main phase).
 */
function playThroughSeeding(state: GameState): GameState {
  let s = state;
  let safety = 0;
  while (s.phase === "seeding") {
    if (++safety > 500) {
      throw new Error(
        `Seeding phase did not complete after 500 actions. ` +
        `Step: ${s.seedingState?.step}, active: ${s.turn.activePlayerId}`,
      );
    }
    const actions = getValidActions(s, s.turn.activePlayerId);
    if (actions.length === 0) {
      throw new Error(`No valid actions at step ${s.seedingState?.step}`);
    }
    s = apply(s, fillAction(s, actions[0]) as SeedingAction);
  }
  return s;
}

describe("seeding phase", () => {
  describe("seed_draw", () => {
    it("is a forced action (single valid action)", () => {
      const state = createSeedingGame();
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_draw");
    });

    it("draws cards from seeding deck to hand", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const activeId = state.turn.activePlayerId;
      const player = state.players.find((p) => p.id === activeId)!;
      const initialDeckSize = player.seedingDeck.length;

      const next = apply(state, firstAction(state, "seed_draw"));
      const updatedPlayer = next.players.find((p) => p.id === activeId)!;

      const drawCount = (DEFAULT_CONFIG.seed_draw as number) ?? 10;
      const expected = Math.min(drawCount, initialDeckSize);
      expect(updatedPlayer.hand).toHaveLength(expected);
      expect(updatedPlayer.seedingDeck).toHaveLength(initialDeckSize - expected);
    });

    it("transitions to seed_keep after all players draw", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const next = drawAllPlayers(state);
      expect(next.seedingState!.step).toBe("seed_keep");
    });

    it("emits seed_cards_drawn event", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const { events } = applyAction(state, firstAction(state, "seed_draw"));
      expect(events.some((e) => e.type === "seed_cards_drawn")).toBe(true);
    });
  });

  describe("seed_keep", () => {
    function stateAtKeep(): GameState {
      return drawAllPlayers(createSeedingGame({ deckSize: 20 }));
    }

    it("requires correct keep/expose counts", () => {
      const state = stateAtKeep();
      const activeId = state.turn.activePlayerId;
      const player = state.players.find((p) => p.id === activeId)!;

      // Wrong counts should fail
      expect(() =>
        applyAction(state, {
          type: "seed_keep",
          playerId: activeId,
          keepIds: [player.hand[0].id],
          exposeIds: [],
        }),
      ).toThrow();
    });

    it("moves kept cards to market deck and exposed to middle area", () => {
      const state = stateAtKeep();
      const activeId = state.turn.activePlayerId;
      const player = state.players.find((p) => p.id === activeId)!;

      const keepIds = player.hand.slice(0, 8).map((c) => c.id);
      const exposeIds = player.hand.slice(8, 10).map((c) => c.id);

      const next = apply(state, {
        type: "seed_keep",
        playerId: activeId,
        keepIds,
        exposeIds,
      });

      const updatedPlayer = next.players.find((p) => p.id === activeId)!;
      expect(updatedPlayer.marketDeck).toHaveLength(8);
      expect(next.seedingState!.middleArea.length).toBeGreaterThanOrEqual(2);
    });

    it("transitions to seed_steal after all players keep", () => {
      const state = keepAllPlayers(stateAtKeep());
      expect(state.seedingState!.step).toBe("seed_steal");
    });
  });

  describe("seed_steal", () => {
    function stateAtSteal(): GameState {
      return keepAllPlayers(drawAllPlayers(createSeedingGame({ deckSize: 20 })));
    }

    it("has valid steal actions for each middle area card", () => {
      const state = stateAtSteal();
      const actions = getValidActions(state, state.turn.activePlayerId);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.type === "seed_steal")).toBe(true);
    });

    it("removes card from middle area", () => {
      const state = stateAtSteal();
      const initialMiddleSize = state.seedingState!.middleArea.length;
      const actions = getValidActions(state, state.turn.activePlayerId) as SeedingAction[];
      const stealAction = findNonLocationSteal(state, actions);

      if (stealAction) {
        const next = apply(state, stealAction);
        expect(next.seedingState!.middleArea.length).toBe(initialMiddleSize - 1);
      }
    });

    it("transitions to seed_draw when middle area empty and decks remain", () => {
      let state = stateAtSteal();

      while (state.seedingState!.middleArea.length > 0) {
        const actions = getValidActions(state, state.turn.activePlayerId) as SeedingAction[];
        const stealAction = findNonLocationSteal(state, actions) ?? actions[0];
        state = apply(state, stealAction);
      }

      // With 20 card decks and 10 drawn, there are still 10 left
      const anyDeckHasCards = state.players.some((p) => p.seedingDeck.length > 0);
      if (anyDeckHasCards) {
        expect(state.seedingState!.step).toBe("seed_draw");
      }
    });
  });

  describe("immutability", () => {
    it("does not mutate the original state during seed_draw", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const originalStep = state.seedingState!.step;
      const activeId = state.turn.activePlayerId;
      const originalDeckSize = state.players.find((p) => p.id === activeId)!.seedingDeck.length;

      apply(state, firstAction(state, "seed_draw"));

      expect(state.seedingState!.step).toBe(originalStep);
      expect(state.players.find((p) => p.id === activeId)!.seedingDeck.length).toBe(originalDeckSize);
    });
  });

  describe("determinism", () => {
    it("produces identical state for the same seed", () => {
      // Use definitionId + position to verify determinism independent of instance counter
      const extractSignature = (state: GameState) =>
        state.players.map((p) => ({
          id: p.id,
          hand: p.hand.map((c) => c.definitionId),
          seedingDeck: p.seedingDeck.map((c) => c.definitionId),
        }));

      const s1 = createSeedingGame({ seed: "det-test", deckSize: 20 });
      const r1 = drawAllPlayers(s1);

      const s2 = createSeedingGame({ seed: "det-test", deckSize: 20 });
      const r2 = drawAllPlayers(s2);

      expect(extractSignature(r1)).toEqual(extractSignature(r2));
      // Also verify RNG state is identical
      expect(r1.rngState).toEqual(r2.rngState);
    });
  });

  describe("phase validation", () => {
    it("rejects seeding actions during main phase", () => {
      const state = createSeedingGame();
      // Force to main phase
      const mainState = { ...state, phase: "main" as const, seedingState: undefined };
      expect(() =>
        applyAction(mainState, { type: "seed_draw", playerId: mainState.turn.activePlayerId }),
      ).toThrow();
    });
  });

  describe("end-to-end", () => {
    // 40 cards per player = 10 locations each (20 total).
    // Grid is 4x4 = 16 cells. Enough locations to fill.
    const e2eConfig = { ...DEFAULT_CONFIG, grid_padding: 2 };

    function e2eGame(seed?: string) {
      return createSeedingGame({ deckSize: 40, policyCount: 3, seed, config: e2eConfig });
    }

    it("completes full seeding phase and transitions to main", () => {
      const result = playThroughSeeding(e2eGame());

      expect(result.phase).toBe("main");
      expect(result.seedingState).toBeUndefined();
    });

    it("each player ends up with 2 active policies", () => {
      const result = playThroughSeeding(e2eGame());

      for (const player of result.players) {
        expect(player.activePolicies).toHaveLength(2);
      }
    });

    it("each player has a starting hand and main deck", () => {
      const result = playThroughSeeding(e2eGame());

      for (const player of result.players) {
        expect(player.hand.length).toBeGreaterThan(0);
        expect(player.mainDeck.length).toBeGreaterThan(0);
      }
    });

    it("grid is fully populated with locations", () => {
      const result = playThroughSeeding(e2eGame());

      for (const row of result.grid) {
        for (const cell of row) {
          expect(cell.location).not.toBeNull();
        }
      }
    });

    it("seeding decks are empty after completion", () => {
      const result = playThroughSeeding(e2eGame());

      for (const player of result.players) {
        expect(player.seedingDeck).toHaveLength(0);
      }
    });

    it("is deterministic with the same seed", () => {
      resetIds();
      const r1 = playThroughSeeding(e2eGame("e2e-det"));

      resetIds();
      const r2 = playThroughSeeding(e2eGame("e2e-det"));

      expect(r1.rngState).toEqual(r2.rngState);
      expect(r1.players.map((p) => p.activePolicies.map((pol) => pol.definitionId))).toEqual(
        r2.players.map((p) => p.activePolicies.map((pol) => pol.definitionId)),
      );
      expect(r1.actionLog.length).toEqual(r2.actionLog.length);
    });
  });
});
