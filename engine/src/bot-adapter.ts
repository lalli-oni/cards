import prand from "pure-rand";
import { fillAction } from "./action-helpers";
import type { Action, Grid, PlayerAdapter, VisibleState } from "./types";

export type BotStrategy = "random" | "greedy";

/**
 * Bot player adapter. Picks actions using a seeded RNG and an optional strategy.
 *
 * - "random" (default): picks a uniformly random valid action.
 * - "greedy": prioritises VP-producing actions (attempt_mission first, then
 *   actions that advance board presence), falling back to random within each
 *   priority tier. Moves are scored to prefer mission locations and cells
 *   with friendly units. Still deterministic for a given seed.
 */
export class BotAdapter implements PlayerAdapter {
  private rng: prand.RandomGenerator;
  private strategy: BotStrategy;

  constructor(seed: number, strategy: BotStrategy = "random") {
    this.rng = prand.mersenne(seed);
    this.strategy = strategy;
  }

  async chooseAction(
    visibleState: VisibleState,
    validActions: Action[],
  ): Promise<Action> {
    if (validActions.length === 0) {
      throw new Error("BotAdapter: no valid actions available");
    }

    const candidates = this.strategy === "greedy"
      ? this.prioritise(validActions, visibleState)
      : validActions;

    const [index, nextRng] = prand.uniformIntDistribution(
      0,
      candidates.length - 1,
      this.rng,
    );
    this.rng = nextRng;

    return fillAction(visibleState, candidates[index]);
  }

  /** Return the highest-priority subset of actions, with move scoring. */
  private prioritise(actions: Action[], state: VisibleState): Action[] {
    const missions = actions.filter((a) => a.type === "attempt_mission");
    if (missions.length > 0) return missions;

    const moves = actions.filter((a) => a.type === "move");
    if (moves.length > 0) {
      const scored = scoreMoves(moves, state);
      if (scored.length > 0) return scored;
    }

    for (const type of GREEDY_PRIORITY) {
      const matches = actions.filter((a) => a.type === type);
      if (matches.length > 0) return matches;
    }

    return actions;
  }
}

/** Action types in priority order (excluding attempt_mission and move, handled separately). */
const GREEDY_PRIORITY: readonly string[] = [
  "enter",
  "deploy",
  "play_event",
  "attack",
  "buy",
  "draw",
  "equip",
  "destroy",
  "raze",
  "activate",
];

/**
 * Score move actions and return only those with the highest score.
 * Prefers moves toward mission locations and cells with friendly units.
 * Retreats to HQ (negative coordinates) are excluded from scoring;
 * returns empty array if all moves are retreats.
 */
function scoreMoves(
  moves: Action[],
  state: VisibleState,
): Action[] {
  const playerId = state.playerId;
  const grid = state.grid;

  let bestScore = -1;
  let best: Action[] = [];

  for (const action of moves) {
    if (action.type !== "move") continue;
    const { row, col } = action;

    if (row < 0 || col < 0) continue;

    const score = scoreCellForMovement(grid, row, col, playerId);
    if (score > bestScore) {
      bestScore = score;
      best = [action];
    } else if (score === bestScore) {
      best.push(action);
    }
  }

  return best;
}

/** Score a grid cell as a movement target. Higher = more desirable. */
function scoreCellForMovement(
  grid: Grid,
  row: number,
  col: number,
  playerId: string,
): number {
  const cell = grid[row][col];
  let score = 0;

  // Strong preference for mission locations (has requirements + rewards)
  if (cell.location?.requirements && cell.location?.rewards) {
    score += 10;
  }

  // Prefer cells with friendly units (cluster for mission requirements)
  const friendlyCount = cell.units.filter((u) => u.ownerId === playerId).length;
  score += friendlyCount * 2;

  // Slight preference for any location (even non-mission)
  if (cell.location) {
    score += 1;
  }

  return score;
}
