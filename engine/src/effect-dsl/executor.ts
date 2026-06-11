import type { Draft } from "immer";
import { fromState, uniformIntDistribution, type RandomGenerator } from "../rng";
import { parse } from "./parser";
import type { Expression, Effect, Step, Primitive, Selector } from "./types";
import type { Card, GameEvent, LocationCard, MainGameState, StatName, UnitCard } from "../types";
import type { QueryListener, EmitFn } from "../listeners/types";
import { getPlayerById } from "../state-helpers";
import { drawOneCard } from "../deck-helpers";
import { killUnit, injureUnit } from "../unit-helpers";
import { findUnitOnGrid } from "../grid-helpers";
import { getModifiedStat } from "../listeners/query";

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  draft: Draft<MainGameState>;
  playerId: string;
  actingUnitId?: string;
  targetId?: string;
  targetCell?: { row: number; col: number };
  emit: EmitFn;
  events: GameEvent[];
  queries: QueryListener[];
  rng: RandomGenerator;
  /** Back-reference to last resolved target (for chains). */
  _lastTarget?: Draft<UnitCard>;
  /** Cards privately peeked by a `peek` verb, consumed by a subsequent `pick`. */
  _peekedCards?: Draft<Card>[];
  /** Location removed by a `raze` verb, consumed by a subsequent `to`. */
  _razedLocation?: Draft<LocationCard>;
}

/** Resolve the acting unit's current position from the grid (lazy, always fresh). */
function getActingPosition(ctx: ExecutionContext): { row: number; col: number } | undefined {
  if (!ctx.actingUnitId) return undefined;
  const found = findUnitOnGrid(ctx.draft.grid, ctx.actingUnitId);
  return found ? { row: found.row, col: found.col } : undefined;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function executeEffect(
  effectStr: string,
  ctx: ExecutionContext,
): { rng: RandomGenerator } {
  const ast = parse(effectStr);
  executeExpression(ast, ctx);
  return { rng: ctx.rng };
}

// ---------------------------------------------------------------------------
// AST walkers
// ---------------------------------------------------------------------------

function executeExpression(expr: Expression, ctx: ExecutionContext): void {
  for (const effect of expr) {
    executeEffectChain(effect, ctx);
  }
}

function executeEffectChain(effect: Effect, ctx: ExecutionContext): void {
  for (const step of effect) {
    executeStep(step, ctx);
  }
}

function executeStep(step: Step, ctx: ExecutionContext): void {
  // Single suspend guard: once any verb has set pickPrompt or viewPrompt,
  // every subsequent step (including contest consequence steps which call
  // executeStep recursively) no-ops. Placing the guard here — rather than at
  // the outer loops — covers every call site uniformly.
  if (ctx.draft.pickPrompt || ctx.draft.viewPrompt) return;

  const p = step.primitive;

  if (p.verb === "contest") {
    executeContest(step, ctx);
    return;
  }

  executePrimitive(p, ctx);
}

// ---------------------------------------------------------------------------
// Verb dispatch
// ---------------------------------------------------------------------------

function executePrimitive(p: Primitive, ctx: ExecutionContext): void {
  switch (p.verb) {
    case "gold":
      return execGold(p, ctx);
    case "vp":
      return execVp(p, ctx);
    case "draw":
      return execDraw(p, ctx);
    case "kill":
      return execKill(p, ctx);
    case "injure":
      return execInjure(p, ctx);
    case "buff":
      return execBuff(p, ctx);
    case "move":
      return execMove(p, ctx);
    case "peek":
      return execPeek(p, ctx);
    case "pick":
      return execPick(p, ctx);
    case "control":
      return execControl(p, ctx);
    case "remove":
      return execRemove(p, ctx);
    case "buy":
      return execBuy(p, ctx);
    case "raze":
      return execRaze(p, ctx);
    case "to":
      return execTo(p, ctx);
    default:
      throw new Error(`Unknown DSL verb: "${p.verb}"`);
  }
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function resolveUnitTargets(
  selector: Selector | undefined,
  ctx: ExecutionContext,
): Draft<UnitCard>[] {
  if (!selector) return [];

  const tokenNames = selector.tokens.map((t) => t.name);
  const hasAll = tokenNames.includes("all");
  const hasAdjacent = tokenNames.includes("adjacent");
  const hasSelf = tokenNames.includes("self");
  const hasEnemy = tokenNames.includes("enemy");
  const hasFriendly = tokenNames.includes("friendly");
  const hasTarget = tokenNames.includes("target");

  // Back-reference to last resolved target
  if (hasTarget && ctx._lastTarget) {
    return [ctx._lastTarget];
  }

  // Self
  if (hasSelf && ctx.actingUnitId) {
    const found = findUnitOnGrid(ctx.draft.grid, ctx.actingUnitId);
    return found ? [found.unit as Draft<UnitCard>] : [];
  }

  // Specific target by ID
  if ((hasEnemy || hasFriendly) && ctx.targetId && !hasAll) {
    const found = findUnitOnGrid(ctx.draft.grid, ctx.targetId);
    return found ? [found.unit as Draft<UnitCard>] : [];
  }

  // Positional: resolve lazily from acting unit's current position
  const position = getActingPosition(ctx);
  if (!position) return [];
  const { row, col } = position;
  let units: Draft<UnitCard>[] = [];

  if (hasAdjacent) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ctx.draft.grid.length && c >= 0 && c < ctx.draft.grid[0].length) {
        units.push(...(ctx.draft.grid[r][c].units as Draft<UnitCard>[]));
      }
    }
  } else {
    units = [...(ctx.draft.grid[row][col].units as Draft<UnitCard>[])];
  }

  // Filter by ownership
  if (hasEnemy) {
    units = units.filter((u) => u.ownerId !== ctx.playerId);
  } else if (hasFriendly) {
    units = units.filter((u) => u.ownerId === ctx.playerId);
    // Exclude self from single-target friendly (unless "all" is specified)
    if (!hasAll && ctx.actingUnitId) {
      units = units.filter((u) => u.id !== ctx.actingUnitId);
    }
  }

  // Apply count limit from token
  const countToken = selector.tokens.find((t) => t.count !== undefined);
  if (countToken?.count !== undefined && !hasAll) {
    units = units.slice(0, countToken.count);
  }

  return units;
}

// ---------------------------------------------------------------------------
// Verb implementations
// ---------------------------------------------------------------------------

function execGold(p: Primitive, ctx: ExecutionContext): void {
  const amount = p.value ?? 0;
  const player = getPlayerById(ctx.draft, ctx.playerId);
  player.gold = Math.max(0, player.gold + amount);
  ctx.emit({ type: "gold_changed", playerId: ctx.playerId, amount, reason: "effect" });
}

function execVp(p: Primitive, ctx: ExecutionContext): void {
  const amount = p.value ?? 0;
  const player = getPlayerById(ctx.draft, ctx.playerId);
  player.vp += amount;
}

function execDraw(p: Primitive, ctx: ExecutionContext): void {
  const count = p.value ?? 1;
  const player = getPlayerById(ctx.draft, ctx.playerId);
  for (let i = 0; i < count; i++) {
    drawOneCard(ctx.draft, player, ctx.events);
  }
  // Sync RNG — drawOneCard may have updated draft.rngState via deck reshuffle
  ctx.rng = fromState(ctx.draft.rngState);
}

function execKill(p: Primitive, ctx: ExecutionContext): void {
  const targets = resolveUnitTargets(p.target, ctx);
  for (const unit of targets) {
    const pos = findUnitOnGrid(ctx.draft.grid, unit.id);
    if (!pos) continue;
    const cell = ctx.draft.grid[pos.row][pos.col];
    killUnit(ctx.draft, cell, unit, pos.row, pos.col, ctx.emit);
  }
}

function execInjure(p: Primitive, ctx: ExecutionContext): void {
  const targets = resolveUnitTargets(p.target, ctx);
  for (const unit of targets) {
    const pos = findUnitOnGrid(ctx.draft.grid, unit.id);
    if (!pos) continue;
    const cell = ctx.draft.grid[pos.row][pos.col];
    if (unit.injured) {
      killUnit(ctx.draft, cell, unit, pos.row, pos.col, ctx.emit);
    } else {
      injureUnit(cell, unit, pos.row, pos.col, ctx.emit);
    }
  }
}

function execBuff(p: Primitive, ctx: ExecutionContext): void {
  const stat = p.subVerb as StatName;
  if (!stat) throw new Error("buff verb requires a stat subVerb (e.g. buff.strength)");
  const delta = p.value ?? 0;
  const duration = p.modifiers.includes("turn") ? 1 : p.modifiers.includes("round") ? 2 : 1;
  const targets = resolveUnitTargets(p.target, ctx);

  for (const unit of targets) {
    if (!unit.statModifiers) unit.statModifiers = [];
    unit.statModifiers.push({
      stat,
      delta,
      remainingDuration: duration,
      source: `buff-${stat}`,
    });
    ctx.emit({ type: "unit_buffed", unitId: unit.id, stat, delta, source: `buff-${stat}` });
  }
}

function execMove(p: Primitive, ctx: ExecutionContext): void {
  const targets = resolveUnitTargets(p.target, ctx);
  if (targets.length === 0) return;
  if (!ctx.targetCell) return;
  const { row: toRow, col: toCol } = ctx.targetCell;

  for (const unit of targets) {
    const pos = findUnitOnGrid(ctx.draft.grid, unit.id);
    if (!pos) continue;

    // Remove from source cell
    const srcCell = ctx.draft.grid[pos.row][pos.col];
    const idx = srcCell.units.findIndex((u) => u.id === unit.id);
    if (idx === -1) continue;
    srcCell.units.splice(idx, 1);

    // Move equipped items with the unit
    for (let i = srcCell.items.length - 1; i >= 0; i--) {
      if (srcCell.items[i].equippedTo === unit.id) {
        ctx.draft.grid[toRow][toCol].items.push(srcCell.items.splice(i, 1)[0]);
      }
    }

    // Add to destination cell
    ctx.draft.grid[toRow][toCol].units.push(unit);

    ctx.emit({
      type: "unit_moved",
      playerId: unit.ownerId,
      unitId: unit.id,
      fromRow: pos.row,
      fromCol: pos.col,
      toRow,
      toCol,
    });
  }
}

// Private peek. Two selectors today:
//   `peek(deck)[N]` — top N of own deck, stored in `_peekedCards` for a chained `pick`.
//   `peek(opponent + hand)` — full hand of the first non-active player (multi-
//     opponent target selection not yet implemented; see #94 / task notes on
//     #111), parked on `viewPrompt` (private to the active player) until they
//     submit `dismiss_view`.
// Both emit `cards_peeked` for engine record-keeping (replay, listeners, debug).
// Privacy filtering of the event log is tracked separately (#105).
function execPeek(p: Primitive, ctx: ExecutionContext): void {
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];

  if (tokenNames.includes("opponent") && tokenNames.includes("hand")) {
    const opponent = ctx.draft.players.find((pl) => pl.id !== ctx.playerId);
    if (!opponent) {
      throw new Error(
        `peek(opponent + hand): no opponent found for player "${ctx.playerId}"`,
      );
    }
    const cards = [...opponent.hand];
    ctx.draft.viewPrompt = {
      playerId: ctx.playerId,
      cards: cards as Card[],
      source: "opponent_hand",
      sourcePlayerId: opponent.id,
    };
    ctx.emit({
      type: "cards_peeked",
      playerId: ctx.playerId,
      cardIds: cards.map((c) => c.id),
      source: "opponent_hand",
    });
    return;
  }

  if (!tokenNames.includes("deck")) return;

  const count = p.value ?? 0;
  const player = getPlayerById(ctx.draft, ctx.playerId);
  const peeked = player.mainDeck.slice(0, count);
  ctx.emit({
    type: "cards_peeked",
    playerId: ctx.playerId,
    cardIds: peeked.map((c) => c.id),
    source: "main_deck",
  });
  ctx._peekedCards = peeked as Draft<Card>[];
}

function execPick(p: Primitive, ctx: ExecutionContext): void {
  const count = p.value ?? 1;
  const peeked = ctx._peekedCards;
  if (peeked === undefined) {
    // Validator (`validateEffectChain`) guarantees a `peek` precedes any
    // `pick` in the same chain. If this fires, something has bypassed it.
    throw new Error(
      "execPick: no peeked cards — validator should have rejected this effect at parse time",
    );
  }
  // Empty deck at runtime: `cards_peeked` event already recorded the empty
  // attempt; no further action.
  if (peeked.length === 0) return;

  // Forced pick (count >= peeked) leaves nothing to choose — auto-take all
  // and continue the chain without pausing.
  // NB: this is one of two `cards_picked` emit sites. The other is
  // handleResolvePick (apply-main.ts), which fires when a player resolves
  // a paused PickPrompt. Keep both sites in sync.
  if (count >= peeked.length) {
    const player = getPlayerById(ctx.draft, ctx.playerId);
    for (const card of peeked) {
      const idx = player.mainDeck.findIndex((c) => c.id === card.id);
      // Defensive: in valid DSL today the cards are guaranteed to still be
      // in mainDeck (peek slices without mutating; nothing runs between
      // peek and pick). If a future verb or listener side-effect mutates
      // the deck mid-execution, fail loud rather than silently emit a
      // lying event. Mirrors handleResolvePick's behavior.
      if (idx === -1) {
        throw new Error(
          `execPick: peeked card "${card.id}" no longer in mainDeck — invariant broken`,
        );
      }
      player.mainDeck.splice(idx, 1);
      player.hand.push(card);
    }
    ctx.emit({
      type: "cards_picked",
      playerId: ctx.playerId,
      cardIds: peeked.map((c) => c.id),
      source: "main_deck",
    });
    ctx._peekedCards = undefined;
    return;
  }

  // Cast: by this point peeked.length >= 2 — the early return handles length
  // 0, and the auto-pick branch above handles any case where count >=
  // peeked.length (which subsumes length 1 with the default count of 1), so
  // the mapped array is non-empty by construction.
  ctx.draft.pickPrompt = {
    kind: "deck_pick",
    playerId: ctx.playerId,
    options: peeked.map((c) => c.id) as [string, ...string[]],
    count,
    source: "main_deck",
  };
  ctx._peekedCards = undefined;
}

function execControl(p: Primitive, ctx: ExecutionContext): void {
  const targets = resolveUnitTargets(p.target, ctx);
  const duration = p.modifiers.includes("turn") ? 1 : p.modifiers.includes("round") ? 2 : 1;

  for (const unit of targets) {
    unit.controlOverride = {
      previousOwnerId: unit.ownerId,
      remainingDuration: duration,
    };
    const prevOwner = unit.ownerId;
    unit.ownerId = ctx.playerId;
    ctx.emit({
      type: "unit_controlled",
      unitId: unit.id,
      controllerId: ctx.playerId,
      previousOwnerId: prevOwner,
      duration,
    });
  }
}

function execRemove(p: Primitive, ctx: ExecutionContext): void {
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];
  if (!tokenNames.includes("location")) return;
  const position = getActingPosition(ctx);
  if (!position) return;
  const { row, col } = position;
  const cell = ctx.draft.grid[row][col];
  if (cell.location) {
    const locId = cell.location.id;
    cell.location = null;
    ctx.emit({ type: "location_razed", row, col, cardId: locId });
  }
}

function execBuy(p: Primitive, ctx: ExecutionContext): void {
  const costOverride = p.value ?? 0;
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];
  const typeFilter = tokenNames.find((t) => ["item", "unit", "event"].includes(t));

  const player = getPlayerById(ctx.draft, ctx.playerId);
  const marketIdx = ctx.draft.market.findIndex((c) => {
    if (!c) return false;
    if (typeFilter && c.type !== typeFilter) return false;
    return true;
  });

  if (marketIdx === -1) return;
  const card = ctx.draft.market.splice(marketIdx, 1)[0];
  if (costOverride > 0) {
    player.gold -= Math.min(costOverride, player.gold);
  }
  player.hand.push(card);
  ctx.emit({ type: "card_bought", playerId: ctx.playerId, cardId: card.id, cardName: card.name, cost: costOverride });
}

function execRaze(p: Primitive, ctx: ExecutionContext): void {
  const position = getActingPosition(ctx);
  if (!position) return;
  const { row, col } = position;
  const cell = ctx.draft.grid[row][col];
  if (!cell.location) return;

  const loc = cell.location;
  cell.location = null;
  ctx.emit({ type: "location_razed", row, col, cardId: loc.id });
  ctx._razedLocation = loc as Draft<LocationCard>;
}

function execTo(p: Primitive, ctx: ExecutionContext): void {
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];

  if (tokenNames.includes("hq") && ctx._razedLocation) {
    const player = getPlayerById(ctx.draft, ctx.playerId);
    player.hq.push(ctx._razedLocation);
    ctx._razedLocation = undefined;
  }
}

// ---------------------------------------------------------------------------
// Contest resolution
// ---------------------------------------------------------------------------

function executeContest(step: Step, ctx: ExecutionContext): void {
  const p = step.primitive;
  const stat = p.subVerb as StatName;
  if (!stat) throw new Error("contest verb requires a stat subVerb");

  const bonus = p.value ?? 0;
  const targets = resolveUnitTargets(p.target, ctx);
  if (targets.length === 0) return;

  const target = targets[0];
  ctx._lastTarget = target;

  if (!ctx.actingUnitId) throw new Error("contest requires an acting unit");
  const actingPos = findUnitOnGrid(ctx.draft.grid, ctx.actingUnitId);
  if (!actingPos) return;
  const attacker = actingPos.unit as Draft<UnitCard>;

  const targetPos = findUnitOnGrid(ctx.draft.grid, target.id);
  if (!targetPos) return;

  // Get modified stats
  const atkStat = getModifiedStat(
    ctx.draft as MainGameState, ctx.queries, attacker as UnitCard, stat,
    { row: actingPos.row, col: actingPos.col },
    { role: "attacker", row: actingPos.row, col: actingPos.col },
  );
  const defStat = getModifiedStat(
    ctx.draft as MainGameState, ctx.queries, target as UnitCard, stat,
    { row: targetPos.row, col: targetPos.col },
    { role: "defender", row: targetPos.row, col: targetPos.col },
  );

  // Roll d6 for each
  const [atkRoll, rng1] = uniformIntDistribution(1, 6, ctx.rng);
  const [defRoll, rng2] = uniformIntDistribution(1, 6, rng1);
  ctx.rng = rng2;

  const atkPower = atkStat + atkRoll + bonus;
  const defPower = defStat + defRoll;

  // Ties go to defender
  const attackerWins = atkPower > defPower;

  ctx.emit({
    type: "contest_resolved",
    stat,
    attackerId: attacker.id,
    defenderId: target.id,
    attackerPower: atkPower,
    defenderPower: defPower,
    winnerId: attackerWins ? attacker.id : target.id,
  });

  if (step.consequence) {
    if (attackerWins && step.consequence.winEffect) {
      for (const winStep of step.consequence.winEffect) {
        executeStep(winStep, ctx);
      }
    } else if (!attackerWins && step.consequence.loseEffect) {
      for (const loseStep of step.consequence.loseEffect) {
        executeStep(loseStep, ctx);
      }
    }
  } else {
    // Default consequences for strength contests
    if (stat === "strength") {
      const loser = attackerWins ? target : attacker;
      const loserPos = findUnitOnGrid(ctx.draft.grid, loser.id);
      if (!loserPos) return;
      const cell = ctx.draft.grid[loserPos.row][loserPos.col];
      const killRatio = 2;
      const winnerPower = attackerWins ? atkPower : defPower;
      const loserPower = attackerWins ? defPower : atkPower;

      if (loser.injured || winnerPower >= killRatio * loserPower) {
        killUnit(ctx.draft, cell, loser, loserPos.row, loserPos.col, ctx.emit);
      } else {
        injureUnit(cell, loser, loserPos.row, loserPos.col, ctx.emit);
      }
    }
  }
}
