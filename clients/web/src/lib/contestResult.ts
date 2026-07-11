import type {
  GameEvent,
  ModifierEntry,
  StatName,
  VisibleState,
} from "cards-engine";
import { findUnitOnGrid } from "cards-engine";

/** Renderer-friendly per-side view, shared by combat (multi-pair, strength
 *  only) and DSL stat contests (single-pair, any stat). `baseStat` is the
 *  unit's base strength / charisma / cunning before modifiers and roll.
 *
 *  `injuredBefore` lives only on combat sides because combat synthesizes
 *  an `"injured"` modifier entry into `modifiers` for display. The popup
 *  renders only the modifier breakdown, so an explicit `injuredBefore`
 *  on the view shape would be dead data — see Finding #17. */
export interface PairSideView {
  unitName: string;
  ownerName: string;
  baseStat: number;
  modifiers: ModifierEntry[];
  roll: number;
  power: number;
}

export interface PairDetail {
  attacker: PairSideView;
  defender: PairSideView;
  winnerSide: "attacker" | "defender" | null;
}

export type CombatPairResolved = Extract<GameEvent, { type: "combat_pair_resolved" }>;
export type ContestResolved = Extract<GameEvent, { type: "contest_resolved" }>;

export interface NameResolvers {
  card: (id: string) => string;
  player: (id: string) => string;
}

/** Combat outcomes are a strict subset of contest outcomes — combat can
 *  only injure or kill. The `controlled` outcome only appears on DSL
 *  contests (Cleopatra's diplomacy). Splitting the union by source is what
 *  makes "no controlled in combat" a compile-time fact. */
export type CombatOutcome =
  | { type: "injured"; unitName: string; ownerName: string; ownerId: string }
  | { type: "killed"; unitName: string; ownerName: string; ownerId: string };

export type ContestOutcome =
  | CombatOutcome
  | {
      type: "controlled";
      /** The unit that switched controllers (e.g. the enemy Cleopatra charmed). */
      unitName: string;
      /** Name of the player who lost control of the unit for `durationTurns`. */
      previousControllerName: string;
      /** Name of the player who won the contest and now controls the unit. */
      newControllerName: string;
      /** Engine `duration` field on `unit_controlled` — rendered as
       *  "for N turn(s)". */
      durationTurns: number;
    };

/** Discriminated by `source`. Splitting `pairs`/`outcomes`/`winnerName`
 *  per arm makes the engine guarantees compile-time visible: a DSL contest
 *  always has a winner (engine resolves ties to defender per
 *  rules/stat-contests.md) and exactly one pair; combat can draw and can
 *  produce multiple pairs. */
export type ContestResult =
  | {
      source: "combat";
      stat: "strength";
      row: number;
      col: number;
      locationName: string;
      attackerName: string;
      defenderName: string;
      /** Player ids for the two sides, so outcome rows can be aligned by owner
       *  without relying on (possibly duplicate) display names. */
      attackerId: string;
      defenderId: string;
      pairs: PairDetail[];
      outcomes: CombatOutcome[];
      winnerName: string | null;
      /** Name of the side that retreated its whole force to HQ (#168), or `null`
       *  if the combat was decided by dice. Drives the retreat line in the dialog. */
      retreatedName: string | null;
    }
  | {
      source: "dsl";
      stat: StatName;
      row: number;
      col: number;
      locationName: string;
      attackerName: string;
      defenderName: string;
      pairs: PairDetail[];
      outcomes: ContestOutcome[];
      winnerName: string;
    };

/** Pure — derives a renderer-friendly pair detail from a combat_pair_resolved
 *  event. Extracted so the outcome → winnerSide mapping is unit-testable. */
export function buildPairDetail(
  ev: CombatPairResolved,
  resolvers: NameResolvers,
): PairDetail {
  const winnerSide: PairDetail["winnerSide"] =
    // Forward-compat: combat never emits "tie" — the engine resolves ties to
    // the defender (see apply-main.ts deriveCombatOutcome). Kept so the mapping
    // stays exhaustive over CombatPairOutcome and to surface a null winner if a
    // future keyword (e.g. Resolute) ever reintroduces a true draw.
    ev.outcome === "tie"
      ? null
      : ev.outcome === "kill_defender" || ev.outcome === "injure_defender"
        ? "attacker"
        : "defender";
  return {
    attacker: {
      unitName: resolvers.card(ev.attacker.unitId),
      ownerName: resolvers.player(ev.attackerPlayerId),
      baseStat: ev.attacker.baseStrength,
      modifiers: ev.attacker.modifiers,
      roll: ev.attacker.roll,
      power: ev.attacker.power,
    },
    defender: {
      unitName: resolvers.card(ev.defender.unitId),
      ownerName: resolvers.player(ev.defenderPlayerId),
      baseStat: ev.defender.baseStrength,
      modifiers: ev.defender.modifiers,
      roll: ev.defender.roll,
      power: ev.defender.power,
    },
    winnerSide,
  };
}

/** Pure — derives a renderer-friendly pair detail from a contest_resolved
 *  event. Contests are 1v1, so the dialog renders a single pair. `winnerSide`
 *  is read directly from `ev.winnerId` (the engine already resolves ties
 *  to defender per `rules/stat-contests.md`, so a null winner is unreachable).
 *
 *  `defenderOwnerName` is passed in because `contest_resolved` doesn't
 *  carry the defender's controller id (it carries `defenderId`, the unit
 *  id, plus `casterPlayerId` for the attacker side only). The caller looks
 *  up the defender unit's current controller from the grid and resolves
 *  the name. Engine event symmetry with `combat_pair_resolved` is tracked
 *  in #153. Throws if `defenderOwnerName` is empty — the contract is that
 *  the caller resolves a real name before calling. */
export function buildPairDetailFromContest(
  ev: ContestResolved,
  resolvers: NameResolvers,
  defenderOwnerName: string,
): PairDetail {
  if (!defenderOwnerName) {
    throw new Error("buildPairDetailFromContest: defenderOwnerName must be a non-empty string");
  }
  return {
    attacker: {
      unitName: resolvers.card(ev.attacker.unitId),
      ownerName: resolvers.player(ev.casterPlayerId),
      baseStat: ev.attacker.baseStat,
      modifiers: ev.attacker.modifiers,
      roll: ev.attacker.roll,
      power: ev.attacker.power,
    },
    defender: {
      unitName: resolvers.card(ev.defender.unitId),
      ownerName: defenderOwnerName,
      baseStat: ev.defender.baseStat,
      modifiers: ev.defender.modifiers,
      roll: ev.defender.roll,
      power: ev.defender.power,
    },
    winnerSide: ev.winnerId === ev.attackerId ? "attacker" : "defender",
  };
}

/** View-derivation for the popup. Pure so it's testable independently
 *  of the Svelte component. */
export interface DialogView {
  title: string;
  showPairCaption: boolean;
  /** `null` means render no message — the winner footer carries the result. */
  emptyOutcomesMsg: string | null;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function buildDialogView(result: ContestResult): DialogView {
  if (result.source === "combat") {
    return {
      title: `Combat at ${result.locationName}`,
      showPairCaption: true,
      // A retreat is not a draw — its own line plus the winner footer describe it,
      // so suppress the no-casualties message when a side withdrew.
      emptyOutcomesMsg: result.retreatedName ? null : "No casualties — draw!",
    };
  }
  return {
    title: `${capitalize(result.stat)} contest at ${result.locationName}`,
    showPairCaption: false,
    // A DSL contest that resolves with a winner but no follow-up effect is
    // fully described by the "{winner} wins!" footer. Engine's executor
    // executeContest's default-consequences branch only emits a kill/injure
    // for stat==='strength', so non-strength contests without an explicit
    // win/lose effect land here.
    emptyOutcomesMsg: result.winnerName ? null : "No effect.",
  };
}

/** Factory result. `result` is non-null on success; `error` is non-null on
 *  failure (or warning that the caller should surface) — both can be set
 *  when the popup renders but a sibling event was dropped. */
export interface ContestResultBuild {
  result: ContestResult | null;
  error: string | null;
}

/** Combat events the result dialog is built from — accumulated across batches. */
const COMBAT_DIALOG_EVENT_TYPES: ReadonlySet<GameEvent["type"]> = new Set([
  "combat_started",
  "combat_pair_resolved",
  "unit_injured",
  "unit_killed",
  "combat_retreated",
  "combat_resolved",
]);

/** What a freshly-processed event batch means for the combat result dialog. */
export type CombatBatchOutcome =
  /** The fight finished this batch — build the dialog from `dialogEvents`. */
  | { kind: "complete"; dialogEvents: readonly GameEvent[] }
  /** Combat began but suspended for the defender's matchup decision (#166) —
   *  the overlay takes over; keep buffering, show nothing yet. */
  | { kind: "suspended" }
  /** A combat resolution / pair with no buffered `combat_started` — genuinely
   *  orphaned (the caller warns and clears any stale dialog). */
  | { kind: "orphan" }
  /** Nothing to surface this batch: either no combat events at all, or a
   *  mid-combat resume round still buffering (pairs resolved, fight not over). */
  | { kind: "none" };

export interface CombatBufferStep {
  /** Events to carry into the next batch (empty once a fight completes). */
  buffer: readonly GameEvent[];
  outcome: CombatBatchOutcome;
}

/** Fold a new event batch into the running combat buffer. Combat spans multiple
 *  batches when the defender assigns matchups (#166): `combat_started` arrives
 *  with the `attack`, and the pair/resolution events with each later
 *  `resolve_combat_round`. Accumulate the fight's events from `combat_started`
 *  until `combat_resolved`, so the dialog is built once from the whole combat
 *  rather than warning on each half. Pure so the batch-splitting edge cases
 *  (suspend, multi-round resume, orphan pair) are testable without a store. */
export function stepCombatBuffer(
  prevBuffer: readonly GameEvent[],
  batch: readonly GameEvent[],
): CombatBufferStep {
  const started: boolean = batch.some((e) => e.type === "combat_started");
  const ended: boolean = batch.some((e) => e.type === "combat_resolved");

  // A fresh `combat_started` begins a new fight; otherwise continue the running
  // one. Only collect while a fight is in flight (started now, or already buffered).
  const buffer: GameEvent[] = started ? [] : [...prevBuffer];
  if (started || buffer.length > 0) {
    for (const e of batch) {
      if (COMBAT_DIALOG_EVENT_TYPES.has(e.type)) buffer.push(e);
    }
  }

  if (ended) {
    // A completion with no buffered `combat_started` can't build a meaningful
    // dialog (e.g. a combat resolved right after a save/load that reset the
    // buffer). Treat it as orphaned so the caller warns rather than silently
    // dropping the popup. The normal paths — atomic, or a load that re-seeds the
    // buffer from `combatPrompt` — always carry the start.
    if (!buffer.some((e) => e.type === "combat_started")) {
      return { buffer: [], outcome: { kind: "orphan" } };
    }
    return { buffer: [], outcome: { kind: "complete", dialogEvents: buffer } };
  }
  if (started) {
    return { buffer, outcome: { kind: "suspended" } };
  }
  if (batch.some((e) => e.type === "combat_pair_resolved")) {
    // A pair with a live buffer is a mid-combat resume round (already collected);
    // a pair with no buffer is a true orphan.
    return prevBuffer.length > 0
      ? { buffer, outcome: { kind: "none" } }
      : { buffer, outcome: { kind: "orphan" } };
  }
  return { buffer, outcome: { kind: "none" } };
}

/** Build the combat-source dialog state from an event batch containing a
 *  `combat_started` (combat is multi-pair strength). Returns `null` result
 *  if `combat_started` is missing from the batch. */
export function buildCombatContestResult(
  events: readonly GameEvent[],
  visibleState: VisibleState | null,
  resolvers: NameResolvers,
): ContestResultBuild {
  const combatStart = events.find((e) => e.type === "combat_started");
  if (!combatStart || combatStart.type !== "combat_started") {
    return { result: null, error: null };
  }
  const combatEnd = events.find((e) => e.type === "combat_resolved");
  const errors: string[] = [];
  if (!combatEnd) {
    errors.push("Combat resolution incomplete (missing combat_resolved event). Some outcomes may be missing from the dialog.");
  }

  const outcomes: CombatOutcome[] = [];
  const pairs: PairDetail[] = [];
  for (const e of events) {
    if (e.type === "unit_injured") {
      outcomes.push({ type: "injured", unitName: resolvers.card(e.unitId), ownerName: resolvers.player(e.controllerId), ownerId: e.controllerId });
    } else if (e.type === "unit_killed") {
      outcomes.push({ type: "killed", unitName: resolvers.card(e.unitId), ownerName: resolvers.player(e.controllerId), ownerId: e.controllerId });
    } else if (e.type === "combat_pair_resolved") {
      pairs.push(buildPairDetail(e, resolvers));
    }
  }

  const retreat = events.find((e) => e.type === "combat_retreated");
  const cell = visibleState?.grid[combatStart.row]?.[combatStart.col];
  return {
    result: {
      source: "combat",
      stat: "strength",
      row: combatStart.row,
      col: combatStart.col,
      locationName: cell?.location?.name ?? `(${combatStart.row},${combatStart.col})`,
      attackerName: resolvers.player(combatStart.attackerId),
      defenderName: resolvers.player(combatStart.defenderId),
      attackerId: combatStart.attackerId,
      defenderId: combatStart.defenderId,
      pairs,
      outcomes,
      winnerName: combatEnd?.type === "combat_resolved" && combatEnd.winnerId
        ? resolvers.player(combatEnd.winnerId)
        : null,
      retreatedName: retreat?.type === "combat_retreated"
        ? resolvers.player(retreat.playerId)
        : null,
    },
    error: errors.length > 0 ? errors.join("\n") : null,
  };
}

/** Build the DSL-source dialog state from a `contest_resolved` event plus
 *  the surrounding batch (for post-contest outcome events). Returns a
 *  non-null `error` (and null `result`) when attacker/defender can't be
 *  located on the visible-state grid — the caller should set `_error` and
 *  clear any stale popup state.
 *
 *  The outcome collector filters to events affecting the two contestants.
 *  A future card whose consequence touches a third unit will land outside
 *  this filter — surface as an additional warning if the agent finder #9
 *  is upgraded to broaden the contract. */
export function buildDslContestResult(
  contestEvent: ContestResolved,
  contestIdx: number,
  events: GameEvent[],
  visibleState: VisibleState | null,
  resolvers: NameResolvers,
): ContestResultBuild {
  const grid = visibleState?.grid;
  const attackerLoc = grid ? findUnitOnGrid(grid, contestEvent.attackerId) : null;
  const defenderLoc = grid ? findUnitOnGrid(grid, contestEvent.defenderId) : null;
  const defenderUnit = defenderLoc?.unit;

  if (!attackerLoc || !defenderUnit) {
    return {
      result: null,
      error: "Contest result: could not locate attacker or defender on the grid — popup skipped.",
    };
  }

  const defenderOwnerName = resolvers.player(defenderUnit.controllerId);
  const detail = buildPairDetailFromContest(contestEvent, resolvers, defenderOwnerName);

  const contestOutcomes: ContestOutcome[] = [];
  // Filter outcomes to the two contestants — outcomes touching third units
  // (e.g. a hypothetical `winEffect: kill(adjacent + enemy)`) fall outside
  // this contract by design (#153 tracks broader contest abstraction).
  const unitIds = new Set([contestEvent.attackerId, contestEvent.defenderId]);
  for (let i = contestIdx + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "unit_killed" && unitIds.has(e.unitId)) {
      contestOutcomes.push({ type: "killed", unitName: resolvers.card(e.unitId), ownerName: resolvers.player(e.controllerId), ownerId: e.controllerId });
    } else if (e.type === "unit_injured" && unitIds.has(e.unitId)) {
      contestOutcomes.push({ type: "injured", unitName: resolvers.card(e.unitId), ownerName: resolvers.player(e.controllerId), ownerId: e.controllerId });
    } else if (e.type === "unit_controlled" && unitIds.has(e.unitId)) {
      contestOutcomes.push({
        type: "controlled",
        unitName: resolvers.card(e.unitId),
        previousControllerName: resolvers.player(e.previousControllerId),
        newControllerName: resolvers.player(e.controllerId),
        durationTurns: e.duration,
      });
    }
  }

  // Guard against same-batch controller swaps changing the defender's owner
  // before our lookup — scan PRECEDING events for a unit_controlled on the
  // defender; if found, use the previousControllerId from that event.
  let safeDefenderOwnerName = defenderOwnerName;
  for (let i = 0; i < contestIdx; i++) {
    const e = events[i];
    if (e.type === "unit_controlled" && e.unitId === contestEvent.defenderId) {
      safeDefenderOwnerName = resolvers.player(e.previousControllerId);
    }
  }
  if (safeDefenderOwnerName !== defenderOwnerName) {
    detail.defender.ownerName = safeDefenderOwnerName;
  }

  const attackerCell = grid?.[attackerLoc.row]?.[attackerLoc.col];
  return {
    result: {
      source: "dsl",
      stat: contestEvent.stat,
      row: attackerLoc.row,
      col: attackerLoc.col,
      locationName: attackerCell?.location?.name ?? `(${attackerLoc.row},${attackerLoc.col})`,
      attackerName: detail.attacker.ownerName,
      defenderName: detail.defender.ownerName,
      pairs: [detail],
      outcomes: contestOutcomes,
      winnerName: detail.winnerSide === "attacker"
        ? detail.attacker.ownerName
        : detail.defender.ownerName,
    },
    error: null,
  };
}
