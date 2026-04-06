import type { Draft } from "immer";
import prand from "pure-rand";
import { parse } from "./parser";
import type { Expression, Effect, Step, Primitive, Selector } from "./types";
import type { GameEvent, MainGameState, UnitCard } from "../types";
import type { QueryListener } from "../listeners/types";
import type { EmitFn } from "../listeners/types";
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
  targetRow?: number;
  targetCol?: number;
  position?: { row: number; col: number };
  emit: EmitFn;
  events: GameEvent[];
  queries: QueryListener[];
  rng: prand.RandomGenerator;
  /** Back-reference to last resolved target (for chains). */
  _lastTarget?: Draft<UnitCard>;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function executeEffect(
  effectStr: string,
  ctx: ExecutionContext,
): { rng: prand.RandomGenerator } {
  const ast = parse(effectStr);
  executeExpression(ast, ctx);
  return { rng: ctx.rng };
}

// ---------------------------------------------------------------------------
// AST walkers
// ---------------------------------------------------------------------------

function executeExpression(expr: Expression, ctx: ExecutionContext): void {
  // Compound effects ("+"): execute all in parallel (sequential in practice)
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
    case "reveal":
      return execReveal(p, ctx);
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
  const hasHere = tokenNames.includes("here");
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

  // Positional: collect units at location(s)
  if (!ctx.position) return [];
  const { row, col } = ctx.position;
  let units: Draft<UnitCard>[] = [];

  if (hasAdjacent) {
    // Units at adjacent cells
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ctx.draft.grid.length && c >= 0 && c < ctx.draft.grid[0].length) {
        units.push(...(ctx.draft.grid[r][c].units as Draft<UnitCard>[]));
      }
    }
  } else {
    // Units at same cell (here)
    units = [...(ctx.draft.grid[row][col].units as Draft<UnitCard>[])];
  }

  // Filter by ownership
  if (hasEnemy) {
    units = units.filter((u) => u.ownerId !== ctx.playerId);
  } else if (hasFriendly) {
    units = units.filter((u) => u.ownerId === ctx.playerId);
  }

  // Exclude self from friendly (unless "all" is also specified)
  if (hasFriendly && !hasAll && ctx.actingUnitId) {
    // Keep self in "all + friendly"
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
  player.gold += amount;
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
  const stat = p.subVerb as "strength" | "cunning" | "charisma";
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
  if (ctx.targetRow === undefined || ctx.targetCol === undefined) return;

  for (const unit of targets) {
    const pos = findUnitOnGrid(ctx.draft.grid, unit.id);
    if (!pos) continue;

    // Remove from source cell
    const srcCell = ctx.draft.grid[pos.row][pos.col];
    const idx = srcCell.units.findIndex((u) => u.id === unit.id);
    if (idx === -1) continue;
    srcCell.units.splice(idx, 1);

    // Add to destination cell
    const dstCell = ctx.draft.grid[ctx.targetRow][ctx.targetCol];
    dstCell.units.push(unit);

    ctx.emit({
      type: "unit_moved",
      playerId: unit.ownerId,
      unitId: unit.id,
      fromRow: pos.row,
      fromCol: pos.col,
      toRow: ctx.targetRow,
      toCol: ctx.targetCol,
    });
  }
}

function execReveal(p: Primitive, ctx: ExecutionContext): void {
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];
  const count = p.value ?? 0;

  if (tokenNames.includes("opponent") && tokenNames.includes("hand")) {
    const opponent = ctx.draft.players.find((pl) => pl.id !== ctx.playerId);
    if (!opponent) return;
    const cardIds = opponent.hand.map((c) => c.id);
    ctx.emit({ type: "cards_revealed", playerId: ctx.playerId, cardIds, source: "reveal" });
  } else if (tokenNames.includes("deck")) {
    // Reveal top N from player's deck
    const player = getPlayerById(ctx.draft, ctx.playerId);
    const revealed = player.mainDeck.slice(0, count);
    const cardIds = revealed.map((c) => c.id);
    ctx.emit({ type: "cards_revealed", playerId: ctx.playerId, cardIds, source: "reveal-deck" });
    // Store revealed cards for pick step
    (ctx as any)._revealedCards = revealed;
  }
}

function execPick(p: Primitive, ctx: ExecutionContext): void {
  const count = p.value ?? 1;
  const revealed = (ctx as any)._revealedCards as Draft<typeof ctx.draft.players[0]["mainDeck"]> | undefined;
  if (!revealed || revealed.length === 0) return;

  const player = getPlayerById(ctx.draft, ctx.playerId);
  // Auto-pick first N cards for v0.1 (player choice refinement later)
  const picked = revealed.slice(0, count);
  for (const card of picked) {
    const idx = player.mainDeck.findIndex((c) => c.id === card.id);
    if (idx !== -1) {
      player.mainDeck.splice(idx, 1);
      player.hand.push(card);
    }
  }
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
  if (tokenNames.includes("location") && ctx.position) {
    const { row, col } = ctx.position;
    const cell = ctx.draft.grid[row][col];
    if (cell.location) {
      const locId = cell.location.id;
      cell.location = null;
      ctx.emit({ type: "location_razed", row, col, cardId: locId });
    }
  }
}

function execBuy(p: Primitive, ctx: ExecutionContext): void {
  const costOverride = p.value ?? 0;
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];
  const typeFilter = tokenNames.find((t) => ["item", "unit", "event"].includes(t));

  const player = getPlayerById(ctx.draft, ctx.playerId);
  // Find first matching card in market
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
  ctx.emit({ type: "card_bought", playerId: ctx.playerId, cardId: card.id, cost: costOverride });
}

function execRaze(p: Primitive, ctx: ExecutionContext): void {
  // Raze the location at the acting unit's position
  if (!ctx.position) return;
  const { row, col } = ctx.position;
  const cell = ctx.draft.grid[row][col];
  if (!cell.location) return;

  const loc = cell.location;
  cell.location = null;
  ctx.emit({ type: "location_razed", row, col, cardId: loc.id });

  // Store for potential "to" redirect
  (ctx as any)._razedLocation = loc;
}

function execTo(p: Primitive, ctx: ExecutionContext): void {
  const tokenNames = p.target?.tokens.map((t) => t.name) ?? [];
  const razedLoc = (ctx as any)._razedLocation;

  if (tokenNames.includes("hq") && razedLoc) {
    const player = getPlayerById(ctx.draft, ctx.playerId);
    player.hq.push(razedLoc);
    (ctx as any)._razedLocation = undefined;
  }
}

// ---------------------------------------------------------------------------
// Contest resolution
// ---------------------------------------------------------------------------

function executeContest(step: Step, ctx: ExecutionContext): void {
  const p = step.primitive;
  const stat = p.subVerb as "strength" | "cunning" | "charisma";
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
  let [atkRoll, rng1] = prand.uniformIntDistribution(1, 6, ctx.rng);
  let [defRoll, rng2] = prand.uniformIntDistribution(1, 6, rng1);
  ctx.rng = rng2;

  const atkPower = atkStat + atkRoll + bonus;
  const defPower = defStat + defRoll;

  // Ties go to defender
  const attackerWins = atkPower > defPower;

  if (step.consequence) {
    // Custom consequences
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
      const winner = attackerWins ? attacker : target;
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
    // Other stats: no default consequence
  }
}
