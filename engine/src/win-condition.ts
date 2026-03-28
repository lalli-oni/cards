import type { EndedGameState, GameEvent, MainGameState } from "./types";
import { getConfigNumber } from "./state-helpers";

/** Build a playerId → VP record from current state. */
export function getScores(state: MainGameState): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const player of state.players) {
    scores[player.id] = player.vp;
  }
  return scores;
}

/** Return the player ID with sole highest VP, or null if tied. */
export function findSoleLeader(state: MainGameState): string | null {
  let maxVp = -Infinity;
  let leaderId: string | null = null;
  let tied = false;

  for (const player of state.players) {
    if (player.vp > maxVp) {
      maxVp = player.vp;
      leaderId = player.id;
      tied = false;
    } else if (player.vp === maxVp) {
      tied = true;
    }
  }

  return tied ? null : leaderId;
}

/** Check whether any player has reached the VP threshold or the turn limit has been exceeded. */
export function shouldEndGame(state: MainGameState): boolean {
  const vpThreshold = getConfigNumber(state, "vp_threshold", 50);
  const turnLimit = getConfigNumber(state, "turn_limit", 20);

  const vpReached = state.players.some((p) => p.vp >= vpThreshold);
  const turnLimitReached = state.turn.round > turnLimit;

  return vpReached || turnLimitReached;
}

/**
 * Transition a MainGameState to EndedGameState.
 * Pushes phase_changed and game_ended events into the provided events array.
 * Safe to call on Immer-frozen state (uses shallow spread, no mutation).
 */
export function toEndedState(
  state: MainGameState,
  winner: string,
  events: GameEvent[],
): EndedGameState {
  const scores = getScores(state);

  events.push({ type: "phase_changed", from: "main", to: "ended" });
  events.push({ type: "game_ended", winner, scores });

  return { ...state, phase: "ended" as const, winner, scores };
}
