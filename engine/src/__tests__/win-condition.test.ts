import { describe, expect, it, beforeEach } from "bun:test";
import { produce } from "immer";
import { applyAction } from "../apply-action";
import type { MainGameState, EndedGameState, MainAction } from "../types";
import { getActivePlayerId } from "../types";
import { findSoleLeader, getScores, shouldEndGame } from "../win-condition";
import { createTestGame, DEFAULT_CONFIG, resetIds } from "./helpers";

beforeEach(() => resetIds());

/** Get player IDs in turn order from the state. */
function turnOrder(state: MainGameState) {
  const first = state.players[0].id;
  const last = state.players[state.players.length - 1].id;
  return { first, last };
}

// ---- Pure helper tests ----

describe("getScores", () => {
  it("maps player VP to a record", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 10;
      d.players[1].vp = 25;
    });
    const scores = getScores(state);
    expect(scores[state.players[0].id]).toBe(10);
    expect(scores[state.players[1].id]).toBe(25);
  });
});

describe("findSoleLeader", () => {
  it("returns leader when one player has highest VP", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 30;
      d.players[1].vp = 10;
    });
    expect(findSoleLeader(state)).toBe(state.players[0].id);
  });

  it("returns null when tied", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 20;
      d.players[1].vp = 20;
    });
    expect(findSoleLeader(state)).toBeNull();
  });

  it("returns null when all players have 0 VP", () => {
    const state = createTestGame();
    expect(findSoleLeader(state)).toBeNull();
  });
});

describe("shouldEndGame", () => {
  it("returns true when VP threshold is reached", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 50;
    });
    expect(shouldEndGame(state)).toBe(true);
  });

  it("returns true when VP exceeds threshold", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 60;
    });
    expect(shouldEndGame(state)).toBe(true);
  });

  it("returns true when turn limit is exceeded", () => {
    const state = produce(createTestGame(), (d) => {
      d.turn.round = 21;
    });
    expect(shouldEndGame(state)).toBe(true);
  });

  it("returns false when neither condition met", () => {
    const state = produce(createTestGame(), (d) => {
      d.players[0].vp = 10;
      d.turn.round = 5;
    });
    expect(shouldEndGame(state)).toBe(false);
  });

  it("respects custom config values", () => {
    const state = createTestGame({
      config: { ...DEFAULT_CONFIG, vp_threshold: 10 },
    });
    const withVp = produce(state, (d) => {
      d.players[0].vp = 10;
    });
    expect(shouldEndGame(withVp)).toBe(true);
  });
});

// ---- Integration: game ends via applyAction ----

describe("win condition integration", () => {
  /** Set up a game where the last player in the round is about to pass. */
  function gameAtRoundEnd(opts: {
    leaderVp?: number;
    otherVp?: number;
    round?: number;
    config?: typeof DEFAULT_CONFIG;
  }): MainGameState {
    const config = opts.config ?? DEFAULT_CONFIG;
    const base = createTestGame({ config });
    const { first, last } = turnOrder(base);
    return produce(base, (d) => {
      // Give VP to the first player (leader) and second player (other)
      const leader = d.players.find((p) => p.id === first)!;
      const other = d.players.find((p) => p.id === last)!;
      leader.vp = opts.leaderVp ?? 0;
      other.vp = opts.otherVp ?? 0;
      d.turn.round = opts.round ?? 1;
      // Set active player to last in turn order, so passing completes the round
      d.turn.activePlayerId = last;
    });
  }

  function passAction(playerId: string): MainAction {
    return { type: "pass", playerId };
  }

  it("transitions to ended phase when VP threshold reached with sole leader", () => {
    const base = createTestGame();
    const { first, last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 50, otherVp: 10 });
    const { state: next, events } = applyAction(state, passAction(last));

    expect(next.phase).toBe("ended");
    const ended = next as EndedGameState;
    expect(ended.winner).toBe(first);
    expect(ended.scores[first]).toBe(50);
    expect(ended.scores[last]).toBe(10);
    expect(events.some((e) => e.type === "game_ended")).toBe(true);
    expect(events.some((e) => e.type === "phase_changed")).toBe(true);
  });

  it("transitions to ended phase when turn limit exceeded with sole leader", () => {
    const base = createTestGame();
    const { first, last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 5, otherVp: 3, round: 20 });
    const { state: next } = applyAction(state, passAction(last));

    expect(next.phase).toBe("ended");
    const ended = next as EndedGameState;
    expect(ended.winner).toBe(first);
  });

  it("continues playing when VP threshold reached but tied", () => {
    const base = createTestGame();
    const { last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 50, otherVp: 50 });
    const { state: next } = applyAction(state, passAction(last));

    expect(next.phase).toBe("main");
  });

  it("continues playing when turn limit reached but tied", () => {
    const base = createTestGame();
    const { last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 10, otherVp: 10, round: 20 });
    const { state: next } = applyAction(state, passAction(last));

    expect(next.phase).toBe("main");
  });

  it("does not end game mid-round", () => {
    const base = createTestGame();
    const { first } = turnOrder(base);
    // First player passes with high VP, but last player still has a turn
    const state = produce(base, (d) => {
      const leader = d.players.find((p) => p.id === first)!;
      leader.vp = 50;
      d.turn.activePlayerId = first;
    });
    const { state: next } = applyAction(state, passAction(first));

    expect(next.phase).toBe("main");
  });

  it("emits game_ended event with correct data", () => {
    const base = createTestGame();
    const { first, last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 55, otherVp: 20 });
    const { events } = applyAction(state, passAction(last));

    const gameEndedEvent = events.find((e) => e.type === "game_ended");
    expect(gameEndedEvent).toBeDefined();
    if (gameEndedEvent?.type === "game_ended") {
      expect(gameEndedEvent.winner).toBe(first);
      expect(gameEndedEvent.scores[first]).toBe(55);
      expect(gameEndedEvent.scores[last]).toBe(20);
    }
  });

  it("emits phase_changed event from main to ended", () => {
    const base = createTestGame();
    const { last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 50, otherVp: 10 });
    const { events } = applyAction(state, passAction(last));

    const phaseEvent = events.find((e) => e.type === "phase_changed");
    expect(phaseEvent).toBeDefined();
    if (phaseEvent?.type === "phase_changed") {
      expect(phaseEvent.from).toBe("main");
      expect(phaseEvent.to).toBe("ended");
    }
  });

  it("works with 3 players", () => {
    const THREE_PLAYERS = [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
      { id: "p3", name: "Carol" },
    ];
    const base = createTestGame({ players: THREE_PLAYERS });
    const { first, last } = turnOrder(base);
    const state = produce(base, (d) => {
      // Give first player highest VP
      d.players[0].vp = 50;
      d.players[1].vp = 30;
      d.players[2].vp = 20;
      d.turn.round = 1;
      d.turn.activePlayerId = last;
    });

    const { state: next } = applyAction(state, passAction(last));
    expect(next.phase).toBe("ended");
    const ended = next as EndedGameState;
    expect(ended.winner).toBe(state.players[0].id);
  });

  it("3-player tie continues playing", () => {
    const THREE_PLAYERS = [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
      { id: "p3", name: "Carol" },
    ];
    const base = createTestGame({ players: THREE_PLAYERS });
    const { last } = turnOrder(base);
    const state = produce(base, (d) => {
      // Two players tied at top
      d.players[0].vp = 50;
      d.players[1].vp = 50;
      d.players[2].vp = 20;
      d.turn.round = 1;
      d.turn.activePlayerId = last;
    });
    const { state: next } = applyAction(state, passAction(last));
    expect(next.phase).toBe("main");
  });

  it("starts next turn after round boundary when game does not end", () => {
    const base = createTestGame();
    const { first, last } = turnOrder(base);
    const state = gameAtRoundEnd({ leaderVp: 5, otherVp: 3 });
    const { state: next, events } = applyAction(state, passAction(last));

    expect(next.phase).toBe("main");
    expect(getActivePlayerId(next)).toBe(first);
    expect(events.some((e) => e.type === "turn_started")).toBe(true);
  });
});
