import type { Action, Card, MainAction, MainGameState, ModifierEntry, ModifierSource, UnitCard } from "../types";
import { parseCost } from "../cost-helpers";
import { getConfigNumber } from "../state-helpers";
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

export interface ModifiedStatBreakdown {
  base: number;
  modifiers: ModifierEntry[];
  /** max(0, base + Σdeltas). */
  final: number;
}

/** Detach a `ModifierSource` from any backing immer draft. Required
 *  whenever a source is read from a unit's `statModifiers` array (draft
 *  members get revoked after `produce` finalizes); also safe to apply
 *  defensively. */
function cloneModifierSource(s: ModifierSource): ModifierSource {
  return { type: s.type, cardId: s.cardId, definitionId: s.definitionId };
}

/** Pure — does not mutate `state` or `queries`. The only blessed
 *  constructor for `ModifiedStatBreakdown`. */
export function getModifiedStatWithSources(
  state: MainGameState,
  queries: QueryListener[],
  unit: UnitCard,
  stat: StatName,
  position?: { row: number; col: number },
  combat?: { role: "attacker" | "defender"; row: number; col: number },
): ModifiedStatBreakdown {
  const base = unit[stat];
  const ctx: StatQueryContext = { unit, stat, position, combat };
  const modifiers: ModifierEntry[] = [];

  for (const q of queries) {
    if (q.query !== "stat") continue;
    const delta = q.modify(state, ctx);
    if (delta === 0) continue;
    // q.source comes from `rebuildListeners` factory output — not a
    // draft — but cloning is cheap and keeps the invariant uniform.
    modifiers.push({ source: cloneModifierSource(q.source), delta });
  }

  for (const mod of unit.statModifiers ?? []) {
    if (mod.stat !== stat) continue;
    if (mod.delta === 0) continue;
    // mod IS a draft member; cloning is load-bearing — without it the
    // source proxy gets revoked when `produce` returns and any later
    // read throws "Proxy has already been revoked".
    modifiers.push({ source: cloneModifierSource(mod.source), delta: mod.delta });
  }

  // Injured units take a global -injury_stat_penalty to every stat
  // (rules/README.md Unit status). Synthesized here — the single source of
  // truth for effective stats — so combat, DSL contests, and mission stat
  // checks all apply it uniformly. `definitionId: "injured"` labels the chip.
  if (unit.injured) {
    const penalty = getConfigNumber(state, "injury_stat_penalty", 1);
    if (penalty !== 0) {
      modifiers.push({
        source: { type: "unit", cardId: unit.id, definitionId: "injured" },
        delta: -penalty,
      });
    }
  }

  const sum = modifiers.reduce((acc, m) => acc + m.delta, 0);
  return { base, modifiers, final: Math.max(0, base + sum) };
}

/**
 * Get a unit's effective stat value after all modifiers.
 * Thin wrapper around `getModifiedStatWithSources` for call sites that
 * only need the final number.
 */
export function getModifiedStat(
  state: MainGameState,
  queries: QueryListener[],
  unit: UnitCard,
  stat: StatName,
  position?: { row: number; col: number },
  combat?: { role: "attacker" | "defender"; row: number; col: number },
): number {
  return getModifiedStatWithSources(state, queries, unit, stat, position, combat).final;
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
