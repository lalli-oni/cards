import { describe, expect, it } from "bun:test";
import type { GameEvent, Session } from "cards-engine";
import { deriveTurnStartIndices, restoreEventLogState } from "../eventLog";

const turnStart = (playerId: string, round: number): GameEvent => ({
  type: "turn_started",
  playerId,
  round,
});
const other = (): GameEvent => ({ type: "card_drawn", playerId: "p1", count: 1 });

describe("deriveTurnStartIndices", () => {
  it("returns zeros for an empty log", () => {
    expect(deriveTurnStartIndices([])).toEqual({ prev: 0, last: 0 });
  });

  it("returns zeros when there is only one turn boundary", () => {
    // A fresh game with one turn started: recap window is empty until turn 2.
    const log: GameEvent[] = [turnStart("p1", 1), other()];
    expect(deriveTurnStartIndices(log)).toEqual({ prev: 0, last: 0 });
  });

  it("points prev/last at the last two turn boundaries", () => {
    const log: GameEvent[] = [
      turnStart("p1", 1), // index 0
      other(), // 1
      turnStart("p2", 1), // 2  <- prev
      other(), // 3
      turnStart("p1", 2), // 4  <- last
      other(), // 5
    ];
    const indices = deriveTurnStartIndices(log);
    expect(indices).toEqual({ prev: 2, last: 4 });
    // The recap slice is exactly the previous completed turn.
    expect(log.slice(indices.prev, indices.last)).toEqual([
      turnStart("p2", 1),
      other(),
    ]);
  });

  it("does not dump the whole history for a long restored log", () => {
    // Regression guard for #147: restoring a non-empty log must not make the
    // recap slice span the entire history.
    const log: GameEvent[] = [];
    for (let round = 1; round <= 5; round++) {
      log.push(turnStart("p1", round), other(), turnStart("p2", round), other());
    }
    const indices = deriveTurnStartIndices(log);
    expect(indices.last).toBe(log.length - 2); // last turn_started, not the end
    expect(indices.last - indices.prev).toBe(2); // one turn's worth, not all of it
  });

  it("treats a single non-zero-index boundary as an absolute offset", () => {
    // Real logs begin with seeding events, so the first turn_started is not at
    // index 0. `last` must be that absolute index, not a 0 fallback.
    const log: GameEvent[] = [
      other(), // 0  (e.g. a seeding event)
      other(), // 1
      turnStart("p1", 1), // 2  <- last
      other(), // 3
    ];
    expect(deriveTurnStartIndices(log)).toEqual({ prev: 0, last: 2 });
  });

  it("returns absolute offsets for both boundaries when events precede them", () => {
    const log: GameEvent[] = [
      other(), // 0  (seeding)
      turnStart("p1", 1), // 1  <- prev
      other(), // 2
      turnStart("p2", 1), // 3  <- last
    ];
    const indices = deriveTurnStartIndices(log);
    expect(indices).toEqual({ prev: 1, last: 3 });
    expect(log.slice(indices.prev, indices.last)).toEqual([
      turnStart("p1", 1),
      other(),
    ]);
  });
});

// A truthy snapshot stub — restoreEventLogState only checks for its presence.
const SNAP: Session["snapshot"] = {} as Session["snapshot"];

describe("restoreEventLogState", () => {
  const log: GameEvent[] = [
    turnStart("p1", 1),
    other(),
    turnStart("p2", 1),
    other(),
  ];

  it("restores the log and derives the recap indices when a snapshot is present", () => {
    expect(restoreEventLogState({ snapshot: SNAP, events: log })).toEqual({
      eventLog: log,
      prev: 0,
      last: 2,
      malformed: false,
    });
  });

  it("falls back to empty for a pre-#147 save with no events field", () => {
    expect(restoreEventLogState({ snapshot: SNAP, events: undefined })).toEqual({
      eventLog: [],
      prev: 0,
      last: 0,
      malformed: false,
    });
  });

  it("returns empty (no double-append) when there is no snapshot to resume from", () => {
    // Without a snapshot, fromSession replays actions and onEvent rebuilds the
    // log; pre-seeding here would double-append and clobber the indices (#147).
    expect(restoreEventLogState({ snapshot: undefined, events: log })).toEqual({
      eventLog: [],
      prev: 0,
      last: 0,
      malformed: false,
    });
  });

  it("flags a present-but-non-array events field as malformed", () => {
    const bad = {} as unknown as GameEvent[];
    expect(restoreEventLogState({ snapshot: SNAP, events: bad })).toEqual({
      eventLog: [],
      prev: 0,
      last: 0,
      malformed: true,
    });
  });

  it("flags entries without a string `type` as malformed", () => {
    const bad = [{ foo: 1 }] as unknown as GameEvent[];
    const result = restoreEventLogState({ snapshot: SNAP, events: bad });
    expect(result.malformed).toBe(true);
    expect(result.eventLog).toEqual([]);
  });
});
