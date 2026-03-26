import type { Draft } from "immer";
import type { GameEvent, MainGameState, PlayerState } from "./types";

/**
 * Parse a cost string (e.g. "2", "2|3") and return the numeric gold cost.
 * When multiple costs are available (pipe-delimited), costIndex selects which.
 */
export function parseCost(costString: string, costIndex?: number): number {
  const costs = costString.split("|").map((s) => s.trim());
  const idx = costIndex ?? 0;
  if (idx < 0 || idx >= costs.length) {
    throw new Error(
      `Cost index ${idx} out of range for cost "${costString}" (${costs.length} options)`,
    );
  }
  const value = Number(costs[idx]);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid cost value "${costs[idx]}" in "${costString}"`);
  }
  return value;
}

/**
 * Try to parse a cost string. Returns the numeric cost or null if invalid.
 * Use in valid-actions computation where invalid costs should be skipped quietly.
 */
export function tryParseCost(costString: string, costIndex?: number): number | null {
  const costs = costString.split("|").map((s) => s.trim());
  const idx = costIndex ?? 0;
  if (idx < 0 || idx >= costs.length) return null;
  const value = Number(costs[idx]);
  return Number.isNaN(value) ? null : value;
}

/** Deduct AP from the active player's turn. Throws if insufficient. */
export function spendAP(draft: Draft<MainGameState>, amount: number): void {
  if (draft.turn.actionPointsRemaining < amount) {
    throw new Error(
      `Not enough AP: need ${amount}, have ${draft.turn.actionPointsRemaining}`,
    );
  }
  draft.turn.actionPointsRemaining -= amount;
}

/** Deduct gold from a player. Throws if insufficient. Emits gold_changed event. */
export function spendGold(
  draft: Draft<MainGameState>,
  player: Draft<PlayerState>,
  amount: number,
  reason: string,
  events: GameEvent[],
): void {
  if (player.gold < amount) {
    throw new Error(
      `Player "${player.id}" cannot afford ${amount} gold (has ${player.gold})`,
    );
  }
  player.gold -= amount;
  events.push({ type: "gold_changed", playerId: player.id, amount: -amount, reason });
}
