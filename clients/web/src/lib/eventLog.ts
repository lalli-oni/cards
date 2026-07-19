import type { GameEvent, Session } from "cards-engine";

/**
 * Turn-boundary indices into the event log used by the pass-device recap.
 * When at least two turns have started, the events in `[prev, last)` are the
 * previous completed turn; with fewer boundaries the window is empty
 * (`prev === last`). Immutable derived result.
 */
export interface TurnStartIndices {
  readonly prev: number;
  readonly last: number;
}

/**
 * Derive the turn-boundary indices from an event log. Used on load (#147) to
 * reconstruct the recap window from a restored log, and by gameStore's
 * `onEvent` as the single source of truth for the live bookkeeping (so the two
 * paths cannot drift).
 *
 * `last` is the index of the final `turn_started` (the current turn's start),
 * or 0 when the log has no turn boundary at all. `prev` is the index of the
 * `turn_started` before it, or 0 when the log has fewer than two boundaries.
 * So `events.slice(prev, last)` yields the previous turn's events once at least
 * two turns have started; with a single boundary it spans everything before
 * that turn (e.g. the seeding events, which precede the first `turn_started` in
 * a real log), and with no boundary it is empty.
 */
export function deriveTurnStartIndices(events: GameEvent[]): TurnStartIndices {
  const turnStarts: number[] = [];
  for (let i: number = 0; i < events.length; i++) {
    if (events[i].type === "turn_started") turnStarts.push(i);
  }
  return {
    last: turnStarts.length > 0 ? turnStarts[turnStarts.length - 1] : 0,
    prev: turnStarts.length > 1 ? turnStarts[turnStarts.length - 2] : 0,
  };
}

/** Outcome of reconstructing the event-log state from a saved session. */
export interface RestoredEventLog {
  readonly eventLog: GameEvent[];
  readonly prev: number;
  readonly last: number;
  /** True when a persisted `events` field was present but not a valid log. */
  readonly malformed: boolean;
}

/**
 * Reconstruct the client's event-log state (`_eventLog` plus the two recap
 * indices) from a saved session, so the restore wiring in gameStore's
 * `loadGame` is a pure, unit-testable step (#147).
 *
 * - Only restores when the session carries a `snapshot`. Without one,
 *   `GameController.fromSession` replays the action log and re-fires `onEvent`,
 *   which rebuilds `_eventLog` from scratch; pre-seeding here would then
 *   double-append and clobber the indices.
 * - A genuinely absent `events` field (pre-#147 saves) falls back to empty.
 * - Persisted data is untyped at runtime (IndexedDB returns whatever was
 *   stored), so a schema-drifted or tampered save is validated before it is
 *   trusted: a non-array or entries without a string `type` are reported as
 *   `malformed` and fall back to empty, rather than deferring a crash to the
 *   first `getEventLog`/`getLastTurnEvents` that maps/slices the log.
 */
export function restoreEventLogState(
  session: Pick<Session, "events" | "snapshot">,
): RestoredEventLog {
  const empty: RestoredEventLog = {
    eventLog: [],
    prev: 0,
    last: 0,
    malformed: false,
  };

  if (!session.snapshot) return empty;

  const raw: GameEvent[] | undefined = session.events;
  if (raw === undefined) return empty;

  const valid: boolean =
    Array.isArray(raw) &&
    raw.every((e) => typeof (e as GameEvent | undefined)?.type === "string");
  if (!valid) return { eventLog: [], prev: 0, last: 0, malformed: true };

  const { prev, last }: TurnStartIndices = deriveTurnStartIndices(raw);
  return { eventLog: raw, prev, last, malformed: false };
}
