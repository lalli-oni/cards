import type { Draft } from "immer";
import type { EmitFn } from "./listeners/types";
import type { ItemCard, MainGameState, UnitCard } from "./types";
import { getPlayerById } from "./state-helpers";

/** Kill a unit: remove from grid cell, drop items, send to controller's discard. */
export function killUnit(
  draft: Draft<MainGameState>,
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  dropEquippedItems(cell, unit, row, col, emit);
  const idx = cell.units.findIndex((u) => u.id === unit.id);
  if (idx !== -1) {
    cell.units.splice(idx, 1);
  }
  // Decision 4 on #91: killed cards route to the current controller's pile.
  // For bought/stolen units this is the buyer/thief, not the original drafter.
  const controller = getPlayerById(draft, unit.controllerId);
  controller.discardPile.push(unit);
  emit({ type: "unit_killed", unitId: unit.id, controllerId: unit.controllerId });
}

/** Injure a unit: set injured flag and emit. Equipment is NOT dropped here —
 *  item drops on injure are combat-specific (apply-main.ts:resolveCombatPair
 *  calls dropEquippedItems itself). Other injure sources (DSL `injure` verb,
 *  trap effects, contest default consequence) leave equipment in place. */
export function injureUnit(unit: Draft<UnitCard>, emit: EmitFn): void {
  unit.injured = true;
  emit({ type: "unit_injured", unitId: unit.id, controllerId: unit.controllerId });
}

/** Pure — decides whether a contest/combat loser is killed or merely injured.
 *  A loser is killed when (a) they were already injured going in, or (b) the
 *  winner's power is at least `killRatio` times the loser's. Otherwise injured.
 *
 *  Tie attribution (who is winner vs loser on equal power) lives in the caller:
 *  both combat and contests assign the defender as winner on equal power (the
 *  attacker becomes the loser) per `rules/stat-contests.md` — see
 *  `deriveCombatOutcome`. Combat no longer emits a `tie` outcome.
 *
 *  Edge case: when `loserPower` is 0, the threshold is trivially met regardless
 *  of `killRatio`, so a zero-power loser is always killed. This is reachable
 *  via the stat-clamp-to-0 path in `executor.ts:executeContest` (and the
 *  combat equivalent in `apply-main.ts:buildCombatantRoll`). */
export function decideKillVsInjure(
  loserInjured: boolean,
  winnerPower: number,
  loserPower: number,
  killRatio: number,
): "kill" | "injure" {
  // killRatio=Infinity is allowed — it's the "no power ratio can ever kill"
  // sentinel useful for tests and future "untouchable" units. NaN and < 1 are
  // rule violations: < 1 makes any win lethal (the rules say a kill requires
  // doubling+), NaN flips the predicate silently.
  if (Number.isNaN(killRatio) || killRatio < 1) {
    throw new Error(`decideKillVsInjure: killRatio must be >= 1 (Infinity allowed), got ${killRatio}`);
  }
  if (!Number.isFinite(winnerPower) || winnerPower < 0) {
    throw new Error(`decideKillVsInjure: winnerPower must be a non-negative finite number, got ${winnerPower}`);
  }
  if (!Number.isFinite(loserPower) || loserPower < 0) {
    throw new Error(`decideKillVsInjure: loserPower must be a non-negative finite number, got ${loserPower}`);
  }
  if (loserInjured) return "kill";
  if (winnerPower >= killRatio * loserPower) return "kill";
  return "injure";
}

/** Drop all items equipped to a unit at the unit's location. */
export function dropEquippedItems(
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  for (const item of cell.items) {
    if (item.equippedTo === unit.id) {
      item.equippedTo = undefined;
      emit({ type: "item_dropped", itemId: item.id, row, col });
    }
  }
}
