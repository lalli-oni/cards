import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import { BotAdapter } from "../bot-adapter";
import {
  GameController,
  InvalidActionError,
  MAX_CONSECUTIVE_REJECTIONS,
} from "../controller";
import type {
  Action,
  GameEvent,
  GameState,
  MainGameState,
  PlayerAdapter,
  Session,
  SetupInput,
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

      // playTurn keeps its throw-based contract for programmatic callers, and
      // the throw is now the typed InvalidActionError that run() keys off of.
      await expect(controller.playTurn()).rejects.toBeInstanceOf(
        InvalidActionError,
      );
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
          throw new Error(
            "attacker adapter must not be asked while combat is suspended",
          );
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

      expect(
        (controller.getState() as MainGameState).combatPrompt,
      ).toBeUndefined();
      expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(
        1,
      );
    });

    // Deep-validation gate (#182 A): a resolve_combat_round with the right type
    // and playerId but a bogus matchup payload passed the old shallow gate and
    // was left for applyAction to throw. It must now be rejected at playTurn.
    it("deep-rejects a malformed combat decision at the playTurn gate", async () => {
      const suspended = buildSuspendedCombat();
      const malformedAdapter: PlayerAdapter = {
        async chooseAction() {
          return {
            type: "resolve_combat_round",
            playerId: "p1",
            decision: {
              kind: "assign_matchups",
              pairs: [{ attackerUnitId: "nope", defenderUnitId: "nope" }],
            },
          };
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
          ["p1", malformedAdapter],
          ["p2", malformedAdapter],
        ]),
      );

      await expect(controller.playTurn()).rejects.toBeInstanceOf(
        InvalidActionError,
      );
    });

    // Loop survival (#182 B): a rejected submission must not tear down run().
    // The decider is re-prompted and a subsequent legal action is applied.
    it("run() survives a rejected action and re-prompts the same decider", async () => {
      const suspended = buildSuspendedCombat();
      const events: GameEvent[] = [];
      const rejected: string[] = [];

      let deciderCalls = 0;
      const deciderViewers: string[] = [];
      const deciderAdapter: PlayerAdapter = {
        async chooseAction(vis: VisibleState, valid: Action[]) {
          deciderCalls++;
          deciderViewers.push(vis.playerId);
          if (deciderCalls === 1) {
            // Structurally-typed but illegal — rejected at the gate.
            return {
              type: "resolve_combat_round",
              playerId: "p1",
              decision: {
                kind: "assign_matchups",
                pairs: [{ attackerUnitId: "nope", defenderUnitId: "nope" }],
              },
            };
          }
          return valid[0]; // greedy default on the re-prompt
        },
      };
      // After the fight resolves the attacker resumes; keep the loop cheap with
      // passes so it winds down to the max-actions guard (the game never ends on
      // passes alone).
      const passAdapter: PlayerAdapter = {
        async chooseAction(_vis: VisibleState, valid: Action[]) {
          return valid.find((a) => a.type === "pass") ?? valid[0];
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
          ["p2", passAdapter],
        ]),
        (evs) => events.push(...evs),
        (err) => rejected.push(err.actingPlayerId),
      );

      // The loop survives the rejection and keeps running; with only passes the
      // game never ends, so the max-actions guard is the terminal signal.
      await expect(controller.run(20)).rejects.toThrow("exceeded 20 actions");

      expect(rejected).toEqual(["p1"]); // re-prompted exactly once, same decider
      expect(deciderCalls).toBeGreaterThanOrEqual(2);
      // The re-prompt routed back to the SAME decider (p1), not the active
      // player: both of the first two prompts projected p1's view. Guards
      // against an accidental p2 turn slipping between the reject and re-prompt.
      expect(deciderViewers.slice(0, 2)).toEqual(["p1", "p1"]);
      expect(events.filter((e) => e.type === "combat_resolved")).toHaveLength(
        1,
      );
      expect(
        (controller.getState() as MainGameState).combatPrompt,
      ).toBeUndefined();
    });

    // A persistently-broken adapter must not spin forever — the consecutive
    // rejection guard converts it into a clean terminal throw.
    it("run() gives up after too many consecutive rejected submissions", async () => {
      let rejections = 0;
      const alwaysInvalid: PlayerAdapter = {
        async chooseAction() {
          return { type: "deploy", playerId: "p1", cardId: "fake" };
        },
      };
      const controller = new GameController({
        config: DEFAULT_CONFIG,
        players: TWO_PLAYERS,
        seed: SEED,
        setupInput: MAIN_SETUP_INPUT,
        adapters: new Map<string, PlayerAdapter>([
          ["p1", alwaysInvalid],
          ["p2", alwaysInvalid],
        ]),
        onInvalidAction: () => {
          rejections++;
        },
      });

      // Giving up wraps the last rejection in an annotated terminal error
      // (with the raw InvalidActionError as `cause`), rather than re-throwing
      // the bare InvalidActionError or looping forever.
      const err = await controller.run().then(
        () => {
          throw new Error("expected run() to reject");
        },
        (e: unknown) => e as Error,
      );
      expect(err.message).toMatch(/gave up after \d+ consecutive/);
      expect(err.cause).toBeInstanceOf(InvalidActionError);
      // It gave up at the *consecutive-rejection* boundary (100), not the
      // max-actions guard (10,000) — the callback fires once per rejection up
      // to but excluding the give-up iteration.
      expect(rejections).toBe(MAX_CONSECUTIVE_REJECTIONS);
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
