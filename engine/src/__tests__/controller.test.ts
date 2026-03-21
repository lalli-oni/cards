import { describe, expect, it } from "bun:test";
import { GameController } from "../controller";
import { BotAdapter } from "../bot-adapter";
import type { GameEvent, GameState, PlayerAdapter, Session, Action, VisibleState, DeckInput } from "../types";
import { DEFAULT_CONFIG, TWO_PLAYERS, SEED } from "./helpers";

const MAIN_DECK_INPUT: DeckInput = {
  mode: "main",
  decks: {
    p1: { mainDeck: [], hand: [], prospectDeck: [], marketDeck: [], activePolicies: [] },
    p2: { mainDeck: [], hand: [], prospectDeck: [], marketDeck: [], activePolicies: [] },
  },
};

function createAdapters(): Map<string, PlayerAdapter> {
  return new Map([
    ["p1", new BotAdapter(1)],
    ["p2", new BotAdapter(2)],
  ]);
}

function createController(onEvent?: (events: GameEvent[], state: GameState) => void) {
  return new GameController({
    config: DEFAULT_CONFIG,
    players: TWO_PLAYERS,
    seed: SEED,
    deckInput: MAIN_DECK_INPUT,
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
      const firstPlayer = controller.getState().turn.activePlayerId;
      await controller.playTurn();
      expect(controller.getState().turn.activePlayerId).not.toBe(firstPlayer);
    });

    it("calls onEvent callback", async () => {
      const receivedEvents: GameEvent[][] = [];
      const controller = createController((events) => receivedEvents.push(events));
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
        deckInput: MAIN_DECK_INPUT,
        adapters: new Map([
          ["p1", badAdapter],
          ["p2", badAdapter],
        ]),
      });

      await expect(controller.playTurn()).rejects.toThrow("invalid action");
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
      expect(session.snapshot!.phase).toBe("main");
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

      const replayed = GameController.fromSession(session, MAIN_DECK_INPUT, createAdapters());
      expect(replayed.getState().turn.round).toBe(
        controller.getState().turn.round,
      );
      expect(replayed.getState().actionLog).toEqual(
        controller.getState().actionLog,
      );
    });

    it("resumes from snapshot", async () => {
      const controller = createController();
      await controller.playTurn();
      const session = controller.toSession(true);

      const resumed = GameController.fromSession(session, MAIN_DECK_INPUT, createAdapters());
      expect(resumed.getState().turn.activePlayerId).toBe(
        controller.getState().turn.activePlayerId,
      );
    });

    it("replay produces same state as live play", async () => {
      const controller = createController();
      await controller.playTurn();
      await controller.playTurn();
      await controller.playTurn();

      const session = controller.toSession();
      const replayed = GameController.fromSession(session, MAIN_DECK_INPUT, createAdapters());

      const liveState = controller.getState();
      const replayState = replayed.getState();

      expect(replayState.turn).toEqual(liveState.turn);
      expect(replayState.players.map(p => p.gold)).toEqual(
        liveState.players.map(p => p.gold),
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
        actions: [
          { type: "pass", playerId: "wrong-player" },
        ],
      };

      expect(() =>
        GameController.fromSession(session, MAIN_DECK_INPUT, createAdapters()),
      ).toThrow(/action 1\/1/);
    });
  });
});
