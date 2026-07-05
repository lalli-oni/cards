import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { BotAdapter } from "../bot-adapter";
import { GameController } from "../controller";
import type {
  Action,
  SetupInput,
  GameEvent,
  GameState,
  MainGameState,
  PlayerAdapter,
  Session,
  VisibleState,
} from "../types";
import {
  createTestGame,
  DEFAULT_CONFIG,
  makeLocation,
  makeUnit,
  resetIds,
  SEED,
  TWO_PLAYERS,
} from "./helpers";

const MAIN_SETUP_INPUT: SetupInput = {
  mode: "main",
  decks: {
    p1: {
      mainDeck: [],
      hand: [],
      prospectDeck: [],
      marketDeck: [],
      activePolicies: [],
    },
    p2: {
      mainDeck: [],
      hand: [],
      prospectDeck: [],
      marketDeck: [],
      activePolicies: [],
    },
  },
};

function createAdapters(): Map<string, PlayerAdapter> {
  return new Map([
    ["p1", new BotAdapter(1)],
    ["p2", new BotAdapter(2)],
  ]);
}

function createController(
  onEvent?: (events: GameEvent[], state: GameState) => void,
) {
  return new GameController({
    config: DEFAULT_CONFIG,
    players: TWO_PLAYERS,
    seed: SEED,
    setupInput: MAIN_SETUP_INPUT,
    adapters: createAdapters(),
    onEvent,
  });
}

describe("GameController", () => {
  it("initializes with a valid game state", () => {
    const controller = createController();
    const state = controller.getState();
    expect(state.phase).toBe("main");
    expect(state.players).toHaveLength(2);
  });

  describe("playTurn", () => {
    it("applies an action and returns events", async () => {
      const controller = createController();
      const events = await controller.playTurn();
      expect(events.length).toBeGreaterThan(0);
    });

    it("advances the active player", async () => {
      const controller = createController();
      const firstPlayer = (controller.getState() as MainGameState).turn
        .activePlayerId;
      await controller.playTurn();
      expect(
        (controller.getState() as MainGameState).turn.activePlayerId,
      ).not.toBe(firstPlayer);
    });

    it("calls onEvent callback", async () => {
      const receivedEvents: GameEvent[][] = [];
      const controller = createController((events) =>
        receivedEvents.push(events),
      );
      await controller.playTurn();
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].length).toBeGreaterThan(0);
    });

    it("rejects invalid actions from adapter", async () => {
      const badAdapter: PlayerAdapter = {
        async chooseAction(_vis: VisibleState, _valid: Action[]) {
          return { type: "deploy", playerId: "p1", cardId: "fake" };
        },
      };
      const controller = new GameController({
        config: DEFAULT_CONFIG,
        players: TWO_PLAYERS,
        seed: SEED,
        setupInput: MAIN_SETUP_INPUT,
        adapters: new Map([
          ["p1", badAdapter],
          ["p2", badAdapter],
        ]),
      });

      await expect(controller.playTurn()).rejects.toThrow("invalid action");
    });
  });

  describe("suspended combat routing", () => {
    // Build a 2v2 combat suspended for the defender's matchup decision.
    function buildSuspendedCombat(): MainGameState {
      resetIds();
      const strongAtk = makeUnit({ ownerId: "p2", strength: 100 });
      const weakAtk = makeUnit({ ownerId: "p2", strength: 1 });
      const strongDef = makeUnit({ ownerId: "p1", strength: 100 });
      const weakDef = makeUnit({ ownerId: "p1", strength: 1 });
      const base = produce(createTestGame(), (d) => {
        d.grid[0][0].location = makeLocation({ ownerId: "p2" });
        d.grid[0][0].units.push(strongAtk, weakAtk, strongDef, weakDef);
      });
      const { state } = applyAction(base, {
        type: "attack",
        playerId: "p2",
        row: 0,
        col: 0,
        unitIds: [strongAtk.id, weakAtk.id],
      });
      const suspended = state as MainGameState;
      // Precondition: p2 (active attacker) is suspended; p1 (defender) decides.
      expect(suspended.combatPrompt?.playerId).toBe("p1");
      expect(suspended.turn.activePlayerId).toBe("p2");
      return suspended;
    }

    // Regression for the #179 finding: `playTurn` drove the loop off the active
    // (attacker) player, whose valid-action list is empty while suspended, so a
    // legitimate defender submission was rejected as "invalid action" and the
    // interactive loop crashed. `playTurn` must route the turn to the decider.
    it("routes a suspended combat's turn to the non-active defender", async () => {
      const suspended = buildSuspendedCombat();

      const events: GameEvent[] = [];
      const deciderAdapter: PlayerAdapter = {
        // Submit the greedy default (getValidActions offers it first).
        async chooseAction(_vis: VisibleState, valid: Action[]) {
          expect(valid.length).toBeGreaterThan(0);
          return valid[0];
        },
      };
      const attackerAdapter: PlayerAdapter = {
        async chooseAction() {
          throw new Error("attacker adapter must not be asked while combat is suspended");
        },
      };

      const session: Session = {
        version: "0.1.0",
        config: DEFAULT_CONFIG,
        players: TWO_PLAYERS,
        seed: SEED,
        actions: [],
        snapshot: suspended,
      };
      const controller = GameController.fromSession(
        session,
        MAIN_SETUP_INPUT,
        new Map<string, PlayerAdapter>([
          ["p1", deciderAdapter],
          ["p2", attackerAdapter],
        ]),
        (evs) => events.push(...evs),
      );

      let guard = 0;
      while ((controller.getState() as MainGameState).combatPrompt) {
        if (guard++ > 10) throw new Error("combat failed to terminate");
        await controller.playTurn();
      }

      expect((controller.getState() as MainGameState).combatPrompt).toBeUndefined();
      expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(1);
    });
  });

  describe("run", () => {
    it("terminates with max actions guard", async () => {
      const controller = createController();
      // With only pass implemented, the game never ends — should hit the guard
      await expect(controller.run(10)).rejects.toThrow("exceeded 10 actions");
    });
  });

  describe("session round-trip", () => {
    it("serializes to a valid session", () => {
      const controller = createController();
      const session = controller.toSession();
      expect(session.version).toBe("0.1.0");
      expect(session.seed).toBe(SEED);
      expect(session.players).toEqual(TWO_PLAYERS);
      expect(session.actions).toEqual([]);
      expect(session.result).toBeUndefined();
    });

    it("includes snapshot when requested", () => {
      const controller = createController();
      const session = controller.toSession(true);
      expect(session.snapshot).toBeDefined();
      expect(session.snapshot?.phase).toBe("main");
    });

    it("snapshot is JSON-serializable", () => {
      const controller = createController();
      const session = controller.toSession(true);
      const json = JSON.stringify(session);
      const parsed = JSON.parse(json);
      expect(parsed.snapshot.phase).toBe("main");
      expect(parsed.snapshot.rngState.length).toBeGreaterThan(0);
    });

    it("replays actions from session", async () => {
      const controller = createController();
      await controller.playTurn();
      await controller.playTurn();
      const session = controller.toSession();
      expect(session.actions).toHaveLength(2);

      const replayed = GameController.fromSession(
        session,
        MAIN_SETUP_INPUT,
        createAdapters(),
      );
      expect((replayed.getState() as MainGameState).turn.round).toBe(
        (controller.getState() as MainGameState).turn.round,
      );
      expect(replayed.getState().actionLog).toEqual(
        controller.getState().actionLog,
      );
    });

    it("resumes from snapshot", async () => {
      const controller = createController();
      await controller.playTurn();
      const session = controller.toSession(true);

      const resumed = GameController.fromSession(
        session,
        MAIN_SETUP_INPUT,
        createAdapters(),
      );
      expect((resumed.getState() as MainGameState).turn.activePlayerId).toBe(
        (controller.getState() as MainGameState).turn.activePlayerId,
      );
    });

    it("replay produces same state as live play", async () => {
      const controller = createController();
      await controller.playTurn();
      await controller.playTurn();
      await controller.playTurn();

      const session = controller.toSession();
      const replayed = GameController.fromSession(
        session,
        MAIN_SETUP_INPUT,
        createAdapters(),
      );

      const liveState = controller.getState() as MainGameState;
      const replayState = replayed.getState() as MainGameState;

      expect(replayState.turn).toEqual(liveState.turn);
      expect(replayState.players.map((p) => p.gold)).toEqual(
        liveState.players.map((p) => p.gold),
      );
      expect(replayState.actionLog).toEqual(liveState.actionLog);
    });
  });

  describe("fromSession error handling", () => {
    it("provides context when replay fails", () => {
      const session: Session = {
        version: "0.1.0",
        config: DEFAULT_CONFIG,
        players: TWO_PLAYERS,
        seed: SEED,
        actions: [{ type: "pass", playerId: "wrong-player" }],
      };

      expect(() =>
        GameController.fromSession(session, MAIN_SETUP_INPUT, createAdapters()),
      ).toThrow(/action 1\/1/);
    });
  });
});
