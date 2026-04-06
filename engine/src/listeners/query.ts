import type { Action, Card, MainAction, MainGameState, UnitCard } from "../types";
import { parseCost } from "../cost-helpers";
import type {
  APQueryContext,
  CostModifierListener,
  CostQueryContext,
  ProtectionKind,
  ProtectionQueryContext,
  QueryListener,
  StatName,
  StatQueryContext,
} from "./types";

/**
 * Get a unit's effective stat value after all modifiers.
 * Pure function — no state mutation.
 */
export function getModifiedStat(
  state: MainGameState,
  queries: QueryListener[],
  unit: UnitCard,
  stat: StatName,
  position?: { row: number; col: number },
  combat?: { role: "attacker" | "defender"; row: number; col: number },
): number {
  const base = unit[stat];
  const ctx: StatQueryContext = { unit, stat, position, combat };

  let delta = 0;
  for (const q of queries) {
    if (q.query !== "stat") continue;
    delta += q.modify(state, ctx);
  }

  // Include temporary stat modifiers from effects (buff verb)
  for (const mod of unit.statModifiers ?? []) {
    if (mod.stat === stat) delta += mod.delta;
  }

  return Math.max(0, base + delta);
}

/**
 * Get the effective cost of a card action after all modifiers.
 * Per-modifier minimum: highest `min` across active modifiers is enforced.
 */
export function getModifiedCost(
  state: MainGameState,
  queries: QueryListener[],
  card: Card,
  playerId: string,
  action: "buy" | "deploy",
  costIndex?: number,
): number {
  const baseCost = parseCost(card.cost, costIndex);
  const ctx: CostQueryContext = { card, playerId, action, costIndex };

  let delta = 0;
  let floor = 0;
  for (const q of queries) {
    if (q.query !== "cost") continue;
    const d = q.modify(state, ctx);
    if (d !== 0) {
      delta += d;
      if (q.min !== undefined && q.min > floor) {
        floor = q.min;
      }
    }
  }

  return Math.max(floor, baseCost + delta);
}

/**
 * Check if a unit is protected from a specific effect.
 */
export function isUnitProtected(
  state: MainGameState,
  queries: QueryListener[],
  unit: UnitCard,
  position: { row: number; col: number },
  kind: ProtectionKind,
  contestStat?: StatName,
): boolean {
  const ctx: ProtectionQueryContext = { unit, position, kind, contestStat };

  for (const q of queries) {
    if (q.query !== "protection") continue;
    if (q.isProtected(state, ctx)) return true;
  }

  return false;
}

/**
 * Get the effective AP cost for an action after all modifiers.
 */
export function getModifiedAPCost(
  state: MainGameState,
  queries: QueryListener[],
  action: MainAction,
  baseCost: number,
): number {
  const ctx: APQueryContext = { action, playerId: action.playerId };

  let delta = 0;
  for (const q of queries) {
    if (q.query !== "ap") continue;
    delta += q.modify(state, ctx);
  }

  return Math.max(0, baseCost + delta);
}

/**
 * Count how many actions matching a predicate the player has taken this turn.
 * Scans actionLog backwards until a "pass" (turn boundary).
 */
export function countActionsThisTurn(
  state: MainGameState,
  playerId: string,
  predicate: (action: Action) => boolean,
): number {
  let count = 0;
  for (let i = state.actionLog.length - 1; i >= 0; i--) {
    const a = state.actionLog[i];
    if (a.type === "pass") break;
    if ("playerId" in a && a.playerId === playerId && predicate(a)) {
      count++;
    }
  }
  return count;
}
