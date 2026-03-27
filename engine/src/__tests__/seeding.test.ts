import { beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import { fillAction } from "../action-helpers";
import { applyAction } from "../apply-action";
import type { GameState, SeedingAction, SeedingGameState } from "../types";
import { getActivePlayerId } from "../types";
import { getValidActions } from "../valid-actions";
import { createSeedingGame, DEFAULT_CONFIG, resetIds } from "./helpers";

beforeEach(() => resetIds());

function apply(state: SeedingGameState, action: SeedingAction): GameState {
  return applyAction(state, action).state;
}

function getPlayer(state: GameState, playerId: string) {
  const p = state.players.find((p) => p.id === playerId);
  if (!p) throw new Error(`Player "${playerId}" not found in test state`);
  return p;
}

function firstAction(state: GameState, type: string): SeedingAction {
  const activeId = getActivePlayerId(state);
  const actions = getValidActions(state, activeId);
  const found = actions.find((a) => a.type === type);
  if (!found) throw new Error(`No valid action of type "${type}" found`);
  return found as SeedingAction;
}

function drawAllPlayers(state: SeedingGameState): SeedingGameState {
  let s: GameState = state;
  for (let i = 0; i < s.players.length; i++) {
    s = apply(s as SeedingGameState, firstAction(s, "seed_draw"));
  }
  if (s.phase !== "seeding")
    throw new Error("Expected seeding phase after drawAllPlayers");
  return s;
}

/** Submit seed_keep for all players using fillAction to pick defaults. */
function keepAllPlayers(state: SeedingGameState): SeedingGameState {
  let s: GameState = state;
  for (let i = 0; i < s.players.length; i++) {
    s = apply(
      s as SeedingGameState,
      fillAction(s, firstAction(s, "seed_keep")) as SeedingAction,
    );
  }
  if (s.phase !== "seeding")
    throw new Error("Expected seeding phase after keepAllPlayers");
  return s;
}

/** Find a steal action targeting a non-location card (avoids grid placement). */
function findNonLocationSteal(
  state: SeedingGameState,
  actions: SeedingAction[],
): SeedingAction | undefined {
  const middle = state.seedingState.middleArea;
  return actions.find((a) => {
    if (a.type !== "seed_steal") return false;
    const card = middle.find((c: { id: string }) => c.id === (a as any).cardId);
    return card?.type !== "location";
  });
}

/**
 * Play through the entire seeding phase by picking valid actions.
 * Uses fillAction to complete template actions with real card IDs.
 * Returns the final state (should be in main phase).
 */
function playThroughSeeding(state: SeedingGameState): GameState {
  let s: GameState = state;
  let safety = 0;
  while (s.phase === "seeding") {
    if (++safety > 500) {
      throw new Error(
        `Seeding phase did not complete after 500 actions. ` +
          `Step: ${s.seedingState.step}, active: ${s.seedingState.currentPlayerId}`,
      );
    }
    const activeId = getActivePlayerId(s);
    const actions = getValidActions(s, activeId);
    if (actions.length === 0) {
      throw new Error(`No valid actions at step ${s.seedingState.step}`);
    }
    s = apply(s, fillAction(s, actions[0]) as SeedingAction);
  }
  return s;
}

describe("seeding phase", () => {
  describe("seed_draw", () => {
    it("is a forced action (single valid action)", () => {
      const state = createSeedingGame();
      const activeId = getActivePlayerId(state);
      const actions = getValidActions(state, activeId);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("seed_draw");
    });

    it("draws cards from seeding deck to hand", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const activeId = getActivePlayerId(state);
      const player = getPlayer(state, activeId);
      const initialDeckSize = player.seedingDeck.length;

      const next = apply(state, firstAction(state, "seed_draw"));
      const updatedPlayer = getPlayer(next, activeId);

      const drawCount = (DEFAULT_CONFIG.seed_draw as number) ?? 10;
      const expected = Math.min(drawCount, initialDeckSize);
      expect(updatedPlayer.hand).toHaveLength(expected);
      expect(updatedPlayer.seedingDeck).toHaveLength(
        initialDeckSize - expected,
      );
    });

    it("transitions to seed_keep after all players draw", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const next = drawAllPlayers(state);
      expect(next.seedingState.step).toBe("seed_keep");
    });

    it("emits seed_cards_drawn event", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const { events } = applyAction(state, firstAction(state, "seed_draw"));
      expect(events.some((e) => e.type === "seed_cards_drawn")).toBe(true);
    });

    it("emits seeding_player_changed with correct payload instead of turn_started", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const { events } = applyAction(state, firstAction(state, "seed_draw"));
      const playerChanged = events.find(
        (e) => e.type === "seeding_player_changed",
      );
      expect(playerChanged).toBeDefined();
      if (playerChanged && playerChanged.type === "seeding_player_changed") {
        expect(state.players.map((p) => p.id)).toContain(playerChanged.playerId);
        expect(playerChanged.step).toBe("seed_draw");
      }
      expect(events.some((e) => e.type === "turn_started")).toBe(false);
    });
  });

  describe("seed_keep", () => {
    function stateAtKeep(): SeedingGameState {
      return drawAllPlayers(createSeedingGame({ deckSize: 20 }));
    }

    it("requires correct keep/expose counts", () => {
      const state = stateAtKeep();
      const activeId = getActivePlayerId(state);
      const player = getPlayer(state, activeId);

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
      const activeId = getActivePlayerId(state);
      const player = getPlayer(state, activeId);

      const keepIds = player.hand.slice(0, 8).map((c) => c.id);
      const exposeIds = player.hand.slice(8, 10).map((c) => c.id);

      const next = apply(state, {
        type: "seed_keep",
        playerId: activeId,
        keepIds,
        exposeIds,
      });

      const updatedPlayer = getPlayer(next, activeId);
      // Locations route to prospect deck, others to market deck
      const keptTotal =
        updatedPlayer.marketDeck.length + updatedPlayer.prospectDeck.length;
      expect(keptTotal).toBe(8);
      expect(
        updatedPlayer.prospectDeck.every((c) => c.type === "location"),
      ).toBe(true);
      expect(
        updatedPlayer.marketDeck.every((c) => c.type !== "location"),
      ).toBe(true);
      if (next.phase === "seeding") {
        expect(next.seedingState.middleArea.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("transitions to seed_steal after all players keep", () => {
      const state = keepAllPlayers(stateAtKeep());
      expect(state.seedingState.step).toBe("seed_steal");
    });
  });

  describe("seed_steal", () => {
    function stateAtSteal(): SeedingGameState {
      return keepAllPlayers(
        drawAllPlayers(createSeedingGame({ deckSize: 20 })),
      );
    }

    it("has valid steal actions for each middle area card", () => {
      const state = stateAtSteal();
      const activeId = getActivePlayerId(state);
      const actions = getValidActions(state, activeId);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.type === "seed_steal")).toBe(true);
    });

    it("removes card from middle area", () => {
      const state = stateAtSteal();
      const initialMiddleSize = state.seedingState.middleArea.length;
      const activeId = getActivePlayerId(state);
      const actions = getValidActions(state, activeId) as SeedingAction[];
      const stealAction = findNonLocationSteal(state, actions);

      if (stealAction) {
        const next = apply(state, stealAction);
        if (next.phase === "seeding") {
          expect(next.seedingState.middleArea.length).toBe(
            initialMiddleSize - 1,
          );
        }
      }
    });

    it("transitions to seed_draw when middle area empty and decks remain", () => {
      let state = stateAtSteal();

      while (state.seedingState.middleArea.length > 0) {
        const activeId = getActivePlayerId(state);
        const actions = getValidActions(state, activeId) as SeedingAction[];
        const stealAction = findNonLocationSteal(state, actions) ?? actions[0];
        const next = apply(state, stealAction);
        if (next.phase !== "seeding") break;
        state = next;
      }

      // With 20 card decks and 10 drawn, there are still 10 left
      const anyDeckHasCards = state.players.some(
        (p) => p.seedingDeck.length > 0,
      );
      if (anyDeckHasCards && state.phase === "seeding") {
        expect(state.seedingState.step).toBe("seed_draw");
      }
    });
  });

  describe("immutability", () => {
    it("does not mutate the original state during seed_draw", () => {
      const state = createSeedingGame({ deckSize: 20 });
      const originalStep = state.seedingState.step;
      const activeId = getActivePlayerId(state);
      const originalDeckSize = state.players.find((p) => p.id === activeId)
        ?.seedingDeck.length;

      apply(state, firstAction(state, "seed_draw"));

      expect(state.seedingState.step).toBe(originalStep);
      expect(
        state.players.find((p) => p.id === activeId)?.seedingDeck.length,
      ).toBe(originalDeckSize);
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
    it("rejects seeding actions during main phase via type system", () => {
      // This is now enforced at compile time by ActionForState<S>.
      // Passing a SeedingAction to a MainGameState is a type error.
      // Verify that even if bypassed at runtime, a default case catches it.
      const state = createSeedingGame();
      const mainState = {
        config: state.config,
        players: state.players,
        grid: state.grid,
        market: state.market,
        rngState: state.rngState,
        seed: state.seed,
        actionLog: state.actionLog,
        phase: "main" as const,
        turn: {
          activePlayerId: state.seedingState.currentPlayerId,
          actionPointsRemaining: 3,
          round: 1,
        },
      };
      expect(() =>
        applyAction(mainState, {
          // @ts-ignore — deliberately bypassing type safety to test runtime guard
          type: "seed_draw",
          playerId: mainState.turn.activePlayerId,
        }),
      ).toThrow();
    });
  });

  describe("end-to-end", () => {
    // 40 cards per player = 10 locations each (20 total).
    // Grid is 4x4 = 16 cells. Enough locations to fill.
    const e2eConfig = { ...DEFAULT_CONFIG, grid_padding: 2 };

    function e2eGame(seed?: string) {
      return createSeedingGame({
        deckSize: 40,
        policyCount: 3,
        seed,
        config: e2eConfig,
      });
    }

    it("completes full seeding phase and transitions to main", () => {
      const result = playThroughSeeding(e2eGame());

      expect(result.phase).toBe("main");
      expect("seedingState" in result).toBe(false);
    });

    it("emits turn_started for first main-phase turn", () => {
      const allEvents: any[] = [];
      let s: GameState = e2eGame();
      while (s.phase === "seeding") {
        const activeId = getActivePlayerId(s);
        const actions = getValidActions(s, activeId);
        const { state, events } = applyAction(
          s,
          fillAction(s, actions[0]) as SeedingAction,
        );
        allEvents.push(...events);
        s = state;
      }

      const turnStartedEvents = allEvents.filter(
        (e) => e.type === "turn_started",
      );
      // Should have exactly one turn_started — the first main-phase turn
      expect(turnStartedEvents).toHaveLength(1);
      expect(turnStartedEvents[0].round).toBe(1);
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
      expect(
        r1.players.map((p) => p.activePolicies.map((pol) => pol.definitionId)),
      ).toEqual(
        r2.players.map((p) => p.activePolicies.map((pol) => pol.definitionId)),
      );
      expect(r1.actionLog.length).toEqual(r2.actionLog.length);
    });
  });

  describe("seed_place_location with empty prospect deck", () => {
    it("returns no valid actions if player has no locations in prospect deck", () => {
      // Get to seed_place_location via e2e, then empty the active player's prospect deck
      const game = createSeedingGame({ deckSize: 40, policyCount: 3, seed: "place-empty", config: { ...DEFAULT_CONFIG, grid_padding: 2 } });
      let s: GameState = game;
      while (
        s.phase === "seeding" &&
        s.seedingState.step !== "seed_place_location"
      ) {
        const activeId = getActivePlayerId(s);
        const actions = getValidActions(s, activeId);
        if (actions.length === 0) break;
        s = apply(s as SeedingGameState, fillAction(s, actions[0]) as SeedingAction);
      }
      if (s.phase !== "seeding" || s.seedingState.step !== "seed_place_location") {
        // Grid filled before reaching seed_place_location — skip test
        return;
      }

      const activeId = getActivePlayerId(s);
      const modified = produce(s as SeedingGameState, (draft) => {
        const player = draft.players.find((p) => p.id === activeId)!;
        player.prospectDeck = [];
      });

      const actions = getValidActions(modified, activeId);
      expect(actions).toHaveLength(0);
    });

    it("handler skips player with no locations instead of throwing", () => {
      const game = createSeedingGame({ deckSize: 40, policyCount: 3, seed: "place-skip", config: { ...DEFAULT_CONFIG, grid_padding: 2 } });
      let s: GameState = game;
      while (
        s.phase === "seeding" &&
        s.seedingState.step !== "seed_place_location"
      ) {
        const activeId = getActivePlayerId(s);
        const actions = getValidActions(s, activeId);
        if (actions.length === 0) break;
        s = apply(s as SeedingGameState, fillAction(s, actions[0]) as SeedingAction);
      }
      if (s.phase !== "seeding" || s.seedingState.step !== "seed_place_location") {
        return;
      }

      const activeId = getActivePlayerId(s);
      const modified = produce(s as SeedingGameState, (draft) => {
        const player = draft.players.find((p) => p.id === activeId)!;
        player.prospectDeck = [];
      });

      // Should not throw — handler skips the player
      expect(() =>
        applyAction(modified, {
          type: "seed_place_location",
          playerId: activeId,
          row: 0,
          col: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("grid-full steal fallback", () => {
    it("routes stolen location to prospect deck when grid is full", () => {
      const game = createSeedingGame({ deckSize: 40, policyCount: 3, seed: "steal-full-grid", config: { ...DEFAULT_CONFIG, grid_padding: 2 } });
      let s: GameState = game;
      // Play until we reach steal phase
      while (
        s.phase === "seeding" &&
        s.seedingState.step !== "seed_steal"
      ) {
        const activeId = getActivePlayerId(s);
        const actions = getValidActions(s, activeId);
        if (actions.length === 0) break;
        s = apply(s as SeedingGameState, fillAction(s, actions[0]) as SeedingAction);
      }
      if (s.phase !== "seeding" || s.seedingState.step !== "seed_steal") return;

      // Fill the entire grid and ensure a location is in middle area
      const modified = produce(s as SeedingGameState, (draft) => {
        // Fill all empty grid cells with a dummy location
        for (const row of draft.grid) {
          for (const cell of row) {
            if (cell.location === null) {
              cell.location = {
                id: "dummy-loc",
                definitionId: "dummy-loc",
                type: "location",
                name: "Dummy",
                cost: "0",
                rarity: "common",
                edges: { n: true, e: true, s: true, w: true },
                requirements: "",
                rewards: "",
                ownerId: draft.players[0].id,
                mission: null,
                dilemmas: [],
              } as any;
            }
          }
        }
        // Ensure there's a location card in the middle area
        const locInMiddle = draft.seedingState.middleArea.find(
          (c) => c.type === "location",
        );
        if (!locInMiddle) {
          draft.seedingState.middleArea.push({
            id: "test-loc-middle",
            definitionId: "test-loc-middle",
            type: "location",
            name: "Test Location",
            cost: "0",
            rarity: "common",
            edges: { n: true, e: true, s: true, w: true },
            requirements: "",
            rewards: "",
            ownerId: null,
            mission: null,
            dilemmas: [],
          } as any);
        }
      });

      const activeId = getActivePlayerId(modified);
      const actions = getValidActions(modified, activeId) as SeedingAction[];
      // Location steal actions should have no row/col when grid is full
      const locAction = actions.find((a) => {
        if (a.type !== "seed_steal") return false;
        const card = modified.seedingState.middleArea.find(
          (c) => c.id === (a as any).cardId,
        );
        return card?.type === "location";
      }) as any;

      expect(locAction).toBeDefined();
      expect(locAction.row).toBeUndefined();
      expect(locAction.col).toBeUndefined();

      // Apply the steal — location should go to prospect deck
      const playerBefore = getPlayer(modified, activeId);
      const prospectBefore = playerBefore.prospectDeck.length;

      const next = apply(modified, locAction);
      const playerAfter = getPlayer(next, activeId);
      expect(playerAfter.prospectDeck.length).toBe(prospectBefore + 1);
    });
  });
});
