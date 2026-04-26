import type { Draft } from "immer";
import { castDraft, produce } from "immer";
import prand from "pure-rand";
import { parseCost, spendAP, spendGold } from "./cost-helpers";
import { drawLocationFromProspect, drawMarketCard, drawOneCard } from "./deck-helpers";
import { checkMissionRequirements, parseRequirements, parseRewards } from "./mission-helpers";
import { findItemPosition, findUnitPosition, getUnitsAtPosition, samePosition } from "./position-helpers";
import {
  areFacingEdgesOpen,
  findUnitOnGrid,
  getBoundaryEdges,
  isOrthogonallyAdjacent,
  isPerimeterCell,
} from "./grid-helpers";
import { extractRngState } from "./rng";
import { findSoleLeader, shouldEndGame, toEndedState } from "./win-condition";
import {
  advanceTurn,
  getConfigNumber,
  getPlayerById,
  placeLocationOnGrid,
} from "./state-helpers";
import { emit as emitEvent } from "./listeners/emit";
import { executeEffect } from "./effect-dsl/executor";
import { rebuildListeners } from "./listeners/rebuild";
import { getModifiedStat, getModifiedCost, getModifiedAPCost } from "./listeners/query";
import type { EmitFn, QueryListener } from "./listeners/types";
import { killUnit, dropEquippedItems } from "./unit-helpers";
import type {
  ActivePassiveEvent,
  ApplyResult,
  GameEvent,
  ItemCard,
  MainAction,
  MainGameState,
  UnitCard,
} from "./types";
import { getActivePlayerId } from "./types";

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

export function runStartOfTurn(
  draft: Draft<MainGameState>,
  emit: EmitFn,
  events: GameEvent[],
): void {
  const player = getPlayerById(draft, draft.turn.activePlayerId);

  // Market population — once, when market is empty (first turn of main phase)
  if (draft.market.length === 0) {
    const drawCount = getConfigNumber(draft, "market_draw_count", 3);
    for (const p of draft.players) {
      for (let i = 0; i < drawCount; i++) {
        const card = drawMarketCard(draft, p, events);
        if (card) {
          const slotIndex = draft.market.length;
          draft.market.push(card);
          emit({
            type: "market_replenished",
            playerId: p.id,
            cardId: card.id,
            slotIndex,
          });
        }
      }
    }
  }

  // Reset AP
  draft.turn.actionPointsRemaining = getConfigNumber(
    draft,
    "action_points_per_turn",
    3,
  );

  // Gold income
  const income = getConfigNumber(draft, "turn_gold_income", 1);
  player.gold += income;
  emit({
    type: "gold_changed",
    playerId: player.id,
    amount: income,
    reason: "turn_income",
  });

  // Draw card
  const cardDrawCount = getConfigNumber(draft, "turn_card_draw", 1);
  for (let i = 0; i < cardDrawCount; i++) {
    drawOneCard(draft, player, events);
  }

  // Heal injured units in HQ
  const hqPosition = { type: "hq" as const, playerId: player.id };
  for (const unit of getUnitsAtPosition(draft.players, draft.grid, hqPosition)) {
    if (unit.injured) {
      unit.injured = false;
      emit({ type: "unit_healed", playerId: player.id, unitId: unit.id });
    }
  }

}

function runEndOfTurn(
  draft: Draft<MainGameState>,
  emit: EmitFn,
): void {
  const player = getPlayerById(draft, draft.turn.activePlayerId);

  // Hand size enforcement
  const maxHandSize = getConfigNumber(draft, "max_hand_size", 7);
  while (player.hand.length > maxHandSize) {
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
    emit({ type: "card_discarded", playerId: player.id, cardId: discarded.id, reason: "hand_limit" });
  }

  // Passive event duration tracking
  for (let i = player.passiveEvents.length - 1; i >= 0; i--) {
    const evt = player.passiveEvents[i];
    evt.remainingDuration -= 1;
    if (evt.remainingDuration <= 0) {
      player.passiveEvents.splice(i, 1);
      player.discardPile.push(evt);
      emit({ type: "passive_expired", playerId: player.id, cardId: evt.id });
    }
  }

  // Expire stat modifiers and control overrides on all grid units
  for (const row of draft.grid) {
    for (const cell of row) {
      for (const unit of cell.units) {
        // Stat modifiers
        if (unit.statModifiers && unit.statModifiers.length > 0) {
          for (let i = unit.statModifiers.length - 1; i >= 0; i--) {
            unit.statModifiers[i].remainingDuration -= 1;
            if (unit.statModifiers[i].remainingDuration <= 0) {
              unit.statModifiers.splice(i, 1);
            }
          }
        }
        // Control override
        if (unit.controlOverride) {
          unit.controlOverride.remainingDuration -= 1;
          if (unit.controlOverride.remainingDuration <= 0) {
            unit.ownerId = unit.controlOverride.previousOwnerId;
            unit.controlOverride = undefined;
          }
        }
      }
    }
  }
}

/**
 * End the current turn and advance to the next player.
 * When a new round begins, the caller is responsible for emitting
 * turn_started and running start-of-turn after checking win conditions.
 *
 * @returns true when a new round begins
 */
function endTurnAndAdvance(
  draft: Draft<MainGameState>,
  emit: EmitFn,
  events: GameEvent[],
): boolean {
  emit({ type: "turn_ended", playerId: draft.turn.activePlayerId });
  runEndOfTurn(draft, emit);
  const roundIncremented = advanceTurn(draft);
  if (!roundIncremented) {
    emit({
      type: "turn_started",
      playerId: draft.turn.activePlayerId,
      round: draft.turn.round,
    });
    runStartOfTurn(draft, emit, events);
  }
  return roundIncremented;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleDeploy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  emit: EmitFn,
  events: GameEvent[],
  queries: QueryListener[],
): void {
  const player = getPlayerById(draft, playerId);
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in player "${playerId}" hand`);
  }

  const card = player.hand[cardIdx];
  if (card.type !== "unit" && card.type !== "item") {
    throw new Error(`Cannot deploy card of type "${card.type}" — only units and items`);
  }

  const cost = getModifiedCost(draft as MainGameState, queries, card, playerId, "deploy");
  spendGold(draft, player, cost, "deploy", events);
  spendAP(draft, 1);

  player.hand.splice(cardIdx, 1);
  player.hq.push(card);

  emit({ type: "card_deployed", playerId, cardId });
}

function handleBuy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  costIndex: number | undefined,
  emit: EmitFn,
  events: GameEvent[],
  queries: QueryListener[],
): void {
  const player = getPlayerById(draft, playerId);
  const slotIndex = draft.market.findIndex((c) => c.id === cardId);
  if (slotIndex === -1) {
    throw new Error(`Card "${cardId}" not found in market`);
  }

  const card = draft.market[slotIndex];
  const cost = getModifiedCost(draft as MainGameState, queries, card, playerId, "buy", costIndex);
  spendGold(draft, player, cost, "buy", events);

  // Remove from market and add to hand
  draft.market.splice(slotIndex, 1);
  player.hand.push(card);
  emit({ type: "card_bought", playerId, cardId, cost });

  // Replenish market slot from active player's market deck
  const replacement = drawMarketCard(draft, player, events);
  if (replacement) {
    draft.market.splice(slotIndex, 0, replacement);
    emit({
      type: "market_replenished",
      playerId: player.id,
      cardId: replacement.id,
      slotIndex,
    });
  }
}

function handleDraw(
  draft: Draft<MainGameState>,
  playerId: string,
  emit: EmitFn,
  events: GameEvent[],
): void {
  const player = getPlayerById(draft, playerId);
  spendAP(draft, 1);
  drawOneCard(draft, player, events);


}

function handleEnter(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  const player = getPlayerById(draft, playerId);
  const unitIdx = player.hq.findIndex((c) => c.id === unitId && c.type === "unit");
  if (unitIdx === -1) {
    throw new Error(`Unit "${unitId}" not found in player "${playerId}" HQ`);
  }

  const gridRows = draft.grid.length;
  const gridCols = draft.grid[0].length;

  if (!isPerimeterCell(gridRows, gridCols, row, col)) {
    throw new Error(`Cell (${row},${col}) is not on the grid perimeter`);
  }

  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location`);
  }

  // Check that at least one boundary edge is open
  const location = cell.location;
  const boundaryEdges = getBoundaryEdges(row, col, gridRows, gridCols);
  const hasOpenBoundaryEdge = boundaryEdges.some(
    (edge) => location.edges[edge],
  );
  if (!hasOpenBoundaryEdge) {
    throw new Error(
      `Cell (${row},${col}) has no open edges facing the grid boundary`,
    );
  }

  spendAP(draft, 1);
  const unit = player.hq.splice(unitIdx, 1)[0] as UnitCard;
  cell.units.push(unit);

  // Move equipped items from HQ to the grid cell with the unit
  for (let i = player.hq.length - 1; i >= 0; i--) {
    const card = player.hq[i];
    if (card.type === "item" && card.equippedTo === unitId) {
      player.hq.splice(i, 1);
      cell.items.push(card as ItemCard);
    }
  }

  emit({ type: "unit_entered", playerId, unitId, row, col });
}

function handleMove(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  toRow: number,
  toCol: number,
  emit: EmitFn,
  queries: QueryListener[],
): void {
  const pos = findUnitOnGrid(draft.grid, unitId);
  if (!pos) {
    throw new Error(`Unit "${unitId}" not found on the grid`);
  }

  const unit = pos.unit;
  if (unit.ownerId !== playerId) {
    throw new Error(`Unit "${unitId}" is not owned by player "${playerId}"`);
  }

  const fromRow = pos.row;
  const fromCol = pos.col;

  // Retreat to HQ: row=-1, col=-1
  if (toRow === -1 && toCol === -1) {
    const gridRows = draft.grid.length;
    const gridCols = draft.grid[0].length;
    if (!isPerimeterCell(gridRows, gridCols, fromRow, fromCol)) {
      throw new Error(`Unit cannot retreat to HQ — not on grid perimeter`);
    }
    const boundaryEdges = getBoundaryEdges(fromRow, fromCol, gridRows, gridCols);
    const fromLoc = draft.grid[fromRow][fromCol].location;
    if (!fromLoc) {
      throw new Error(`Unit at (${fromRow},${fromCol}) has no location — cannot retreat`);
    }
    const hasOpenBoundaryEdge = boundaryEdges.some(
      (edge) => fromLoc.edges[edge],
    );
    if (!hasOpenBoundaryEdge) {
      throw new Error(`Unit cannot retreat — no open boundary edges`);
    }

    const baseApCost = unit.injured
      ? 1 + getConfigNumber(draft, "injury_move_penalty", 1)
      : 1;
    const apCost = getModifiedAPCost(
      draft as MainGameState, queries,
      { type: "move", playerId, unitId, row: toRow, col: toCol }, baseApCost,
    );
    spendAP(draft, apCost);

    const cell = draft.grid[fromRow][fromCol];
    const idx = cell.units.findIndex((u) => u.id === unitId);
    if (idx === -1) {
      throw new Error(`Unit "${unitId}" not found at (${fromRow},${fromCol}) during retreat`);
    }
    const removed = cell.units.splice(idx, 1)[0];
    const player = getPlayerById(draft, playerId);
    player.hq.push(removed);

    // Move equipped items from grid cell to HQ with the unit
    for (let i = cell.items.length - 1; i >= 0; i--) {
      if (cell.items[i].equippedTo === unitId) {
        player.hq.push(cell.items.splice(i, 1)[0]);
      }
    }

    emit({
      type: "unit_moved",
      playerId,
      unitId,
      fromRow,
      fromCol,
      toRow: -1,
      toCol: -1,
    });

    return;
  }

  if (!isOrthogonallyAdjacent(fromRow, fromCol, toRow, toCol)) {
    throw new Error(
      `Cell (${toRow},${toCol}) is not adjacent to (${fromRow},${fromCol})`,
    );
  }

  if (!draft.grid[toRow]?.[toCol]?.location) {
    throw new Error(`Cell (${toRow},${toCol}) has no location`);
  }

  if (!areFacingEdgesOpen(draft.grid, fromRow, fromCol, toRow, toCol)) {
    throw new Error(
      `Facing edges between (${fromRow},${fromCol}) and (${toRow},${toCol}) are blocked`,
    );
  }

  const apCost = unit.injured
    ? 1 + getConfigNumber(draft, "injury_move_penalty", 1)
    : 1;
  spendAP(draft, apCost);

  const fromCell = draft.grid[fromRow][fromCol];
  const idx = fromCell.units.findIndex((u) => u.id === unitId);
  if (idx === -1) {
    throw new Error(`Unit "${unitId}" not found at (${fromRow},${fromCol}) during move`);
  }
  const removed = fromCell.units.splice(idx, 1)[0];
  draft.grid[toRow][toCol].units.push(removed);

  // Move equipped items from source cell to destination cell with the unit
  for (let i = fromCell.items.length - 1; i >= 0; i--) {
    if (fromCell.items[i].equippedTo === unitId) {
      draft.grid[toRow][toCol].items.push(fromCell.items.splice(i, 1)[0]);
    }
  }

  emit({ type: "unit_moved", playerId, unitId, fromRow, fromCol, toRow, toCol });
}

function handlePlayEvent(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  targetId: string | undefined,
  emit: EmitFn,
  events: GameEvent[],
  queries: QueryListener[],
): void {
  const player = getPlayerById(draft, playerId);
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in player "${playerId}" hand`);
  }

  const card = player.hand[cardIdx];
  if (card.type !== "event") {
    throw new Error(`Card "${cardId}" is not an event (type: ${card.type})`);
  }

  const cost = parseCost(card.cost);
  spendGold(draft, player, cost, "play_event", events);
  spendAP(draft, 1);

  player.hand.splice(cardIdx, 1);

  switch (card.subtype) {
    case "instant": {
      if (card.effect) {
        let rng = prand.mersenne.fromState(draft.rngState);
        const result = executeEffect(card.effect, {
          draft, playerId, emit,
          events, queries,
          rng,
        });
        draft.rngState = extractRngState(result.rng) as number[];
      }
      player.discardPile.push(card);
      emit({ type: "event_played", playerId, cardId });
      break;
    }

    case "passive":
      player.passiveEvents.push({
        ...card,
        remainingDuration: card.duration,
        ...(targetId != null ? { targetId } : {}),
      } as ActivePassiveEvent);
      emit({ type: "event_played", playerId, cardId });
      break;

    case "trap":
      player.activeTraps.push({ card, targetId });
      emit({ type: "trap_set", playerId, cardId, targetId });
      break;

    default:
      throw new Error(`Unknown event subtype "${(card as any).subtype}" for card "${cardId}"`);
  }



}

function handleEquip(
  draft: Draft<MainGameState>,
  playerId: string,
  itemId: string,
  unitId: string,
  emit: EmitFn,
): void {
  const itemResult = findItemPosition(draft.players, draft.grid, itemId);
  if (!itemResult) {
    throw new Error(`Item "${itemId}" not found in HQ or on grid`);
  }

  const unitResult = findUnitPosition(draft.players, draft.grid, unitId);
  if (!unitResult) {
    throw new Error(`Unit "${unitId}" not found in HQ or on grid`);
  }

  if (!samePosition(itemResult.position, unitResult.position)) {
    throw new Error(`Unit "${unitId}" not co-located with item "${itemId}"`);
  }

  spendAP(draft, 1);

  const item = itemResult.item;
  if (item.equippedTo) {
    item.equippedTo = undefined;
  }

  item.equippedTo = unitId;
  emit({ type: "item_equipped", playerId, itemId, unitId });
}

function handleDestroy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  emit: EmitFn,
): void {
  const player = getPlayerById(draft, playerId);
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in player "${playerId}" hand`);
  }

  spendAP(draft, 1);
  const card = player.hand.splice(cardIdx, 1)[0];
  player.removedFromGame.push(card);

  emit({ type: "card_destroyed", playerId, cardId });
}

function handleRaze(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  row: number,
  col: number,
  rotation: number | undefined,
  emit: EmitFn,
  events: GameEvent[],
): void {
  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location to raze`);
  }

  const unitIdx = cell.units.findIndex((u) => u.id === unitId);
  if (unitIdx === -1) {
    throw new Error(`Unit "${unitId}" not found at cell (${row},${col})`);
  }

  const unit = cell.units[unitIdx];
  if (unit.ownerId !== playerId) {
    throw new Error(`Unit "${unitId}" is not owned by player "${playerId}"`);
  }

  // No enemy units allowed
  const hasEnemyUnits = cell.units.some((u) => u.ownerId !== playerId);
  if (hasEnemyUnits) {
    throw new Error(`Cannot raze — enemy units present at (${row},${col})`);
  }

  const razeCost = getConfigNumber(draft, "raze_ap_cost", 3);
  spendAP(draft, razeCost);

  const razedLocationId = cell.location.id;

  // Discard all units at location to their owners' discard piles
  for (const u of cell.units) {
    const owner = getPlayerById(draft, u.ownerId);
    owner.discardPile.push(u);
  }
  cell.units = [];

  // Discard all items at location
  for (const item of cell.items) {
    const owner = getPlayerById(draft, item.ownerId);
    owner.discardPile.push(item);
  }
  cell.items = [];

  // Discard the location
  const player = getPlayerById(draft, playerId);
  player.discardPile.push(cell.location);
  cell.location = null;

  emit({ type: "location_razed", row, col, cardId: razedLocationId });

  // Draw replacement location from prospect deck
  const newLocation = drawLocationFromProspect(draft, player, events);
  if (newLocation) {
    placeLocationOnGrid(draft, newLocation, row, col, rotation);
    emit({ type: "location_placed", row, col, cardId: newLocation.id });
  }



}

function handleAttack(
  draft: Draft<MainGameState>,
  playerId: string,
  unitIds: string[],
  row: number,
  col: number,
  emit: EmitFn,
  queries: QueryListener[],
): void {
  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location`);
  }

  // Validate all committed units are at this cell and owned by player
  const attackers: Draft<UnitCard>[] = [];
  for (const uid of unitIds) {
    const unit = cell.units.find((u) => u.id === uid);
    if (!unit) {
      throw new Error(`Unit "${uid}" not found at cell (${row},${col})`);
    }
    if (unit.ownerId !== playerId) {
      throw new Error(`Unit "${uid}" is not owned by player "${playerId}"`);
    }
    attackers.push(unit);
  }

  // Find defender(s) — all enemy units at location
  const defenders = cell.units.filter((u) => u.ownerId !== playerId);
  if (defenders.length === 0) {
    throw new Error(`No enemy units at cell (${row},${col}) to attack`);
  }

  const defenderId = defenders[0].ownerId;
  spendAP(draft, 1);

  emit({ type: "combat_started", row, col, attackerId: playerId, defenderId });

  let rng = prand.mersenne.fromState(draft.rngState);

  // Auto-resolve combat rounds
  const maxRounds = 10; // safety limit
  for (let round = 0; round < maxRounds; round++) {
    const livingAttackers = attackers.filter((u) => !isDeadOrRemoved(cell, u));
    const livingDefenders = defenders.filter((u) => !isDeadOrRemoved(cell, u));

    if (livingAttackers.length === 0 || livingDefenders.length === 0) break;

    // Roll for each unit
    const atkRolls: { unit: Draft<UnitCard>; power: number }[] = [];
    for (const u of livingAttackers) {
      const [roll, nextRng] = prand.uniformIntDistribution(1, 6, rng);
      rng = nextRng;
      const modifiedStr = getModifiedStat(
        draft as MainGameState, queries, u as UnitCard, "strength",
        { row, col }, { role: "attacker", row, col },
      );
      const strength = u.injured ? Math.max(0, modifiedStr - getConfigNumber(draft, "injury_stat_penalty", 1)) : modifiedStr;
      atkRolls.push({ unit: u, power: strength + roll });
    }

    const defRolls: { unit: Draft<UnitCard>; power: number }[] = [];
    for (const u of livingDefenders) {
      const [roll, nextRng] = prand.uniformIntDistribution(1, 6, rng);
      rng = nextRng;
      const modifiedStr = getModifiedStat(
        draft as MainGameState, queries, u as UnitCard, "strength",
        { row, col }, { role: "defender", row, col },
      );
      const strength = u.injured ? Math.max(0, modifiedStr - getConfigNumber(draft, "injury_stat_penalty", 1)) : modifiedStr;
      defRolls.push({ unit: u, power: strength + roll });
    }

    // Sort by power descending, pair highest vs highest
    atkRolls.sort((a, b) => b.power - a.power);
    defRolls.sort((a, b) => b.power - a.power);

    const pairs = Math.min(atkRolls.length, defRolls.length);
    for (let i = 0; i < pairs; i++) {
      const atk = atkRolls[i];
      const def = defRolls[i];
      resolveCombatPair(draft, cell, atk, def, row, col, emit);
    }
  }

  draft.rngState = extractRngState(rng) as number[];

  // Determine winner
  const remainingAttackers = attackers.filter((u) => !isDeadOrRemoved(cell, u));
  const remainingDefenders = defenders.filter((u) => !isDeadOrRemoved(cell, u));

  let winnerId: string | null = null;
  if (remainingAttackers.length > 0 && remainingDefenders.length === 0) {
    winnerId = playerId;
  } else if (remainingDefenders.length > 0 && remainingAttackers.length === 0) {
    winnerId = defenderId;
  }

  emit({ type: "combat_resolved", row, col, winnerId });
}

/** Check if a unit has been removed from the cell (killed/discarded). */
function isDeadOrRemoved(
  cell: Draft<{ units: UnitCard[] }>,
  unit: Draft<UnitCard>,
): boolean {
  return !cell.units.some((u) => u.id === unit.id);
}

/** Resolve a single 1v1 combat pair. */
function resolveCombatPair(
  draft: Draft<MainGameState>,
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  atk: { unit: Draft<UnitCard>; power: number },
  def: { unit: Draft<UnitCard>; power: number },
  row: number,
  col: number,
  emit: EmitFn,
): void {
  if (atk.power === def.power) return; // tie — nothing happens

  const winner = atk.power > def.power ? atk : def;
  const loser = atk.power > def.power ? def : atk;
  const killRatio = getConfigNumber(draft, "combat_kill_ratio", 2);
  const isKill = winner.power >= killRatio * loser.power;

  if (isKill || loser.unit.injured) {
    // Kill: remove unit from grid, drop items, send to owner's discard
    killUnit(draft, cell, loser.unit, row, col, emit);
  } else {
    // Injure
    loser.unit.injured = true;
    // Drop equipped items at location
    dropEquippedItems(cell, loser.unit, row, col, emit);
    emit({ type: "unit_injured", unitId: loser.unit.id, ownerId: loser.unit.ownerId });
  }
}

// ---------------------------------------------------------------------------
// Mission attempt
// ---------------------------------------------------------------------------

function handleAttemptMission(
  draft: Draft<MainGameState>,
  playerId: string,
  row: number,
  col: number,
  emit: EmitFn,
  events: GameEvent[],
  queries: QueryListener[],
): void {
  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location`);
  }
  if (!cell.location.requirements || !cell.location.rewards) {
    throw new Error(`Location at (${row},${col}) has no mission`);
  }

  const friendlyUnits = cell.units.filter((u) => u.ownerId === playerId);
  if (friendlyUnits.length === 0) {
    throw new Error(`No friendly units at (${row},${col})`);
  }

  spendAP(draft, 1);

  const requirements = parseRequirements(cell.location.requirements);
  const { vp } = parseRewards(cell.location.rewards);

  if (!checkMissionRequirements(requirements, friendlyUnits, draft as MainGameState, queries, { row, col })) {
    emit({
      type: "mission_attempt_failed",
      playerId,
      row,
      col,
      locationId: cell.location.id,
    });


    return;
  }

  const player = getPlayerById(draft, playerId);
  const locationId = cell.location.id;

  // Award VP
  player.vp += vp;

  // All units at location → completing player's discard (regardless of owner)
  for (const u of cell.units) {
    player.discardPile.push(u);
  }
  cell.units = [];

  // All items at location → completing player's discard
  for (const item of cell.items) {
    player.discardPile.push(item);
  }
  cell.items = [];

  // Completed mission location → removed from game (not discard, to avoid reshuffle)
  // TODO(#59): move to scoring area when HQ is on grid
  player.removedFromGame.push(cell.location);
  cell.location = null;

  emit({ type: "mission_completed", playerId, locationId, vp });

  // Draw replacement location from prospect deck
  const newLocation = drawLocationFromProspect(draft, player, events);
  if (newLocation) {
    placeLocationOnGrid(draft, newLocation, row, col);
    emit({ type: "location_placed", row, col, cardId: newLocation.id });
  }



}

function handleActivate(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  actionName: string,
  targetId: string | undefined,
  targetCell: { row: number; col: number } | undefined,
  emit: EmitFn,
  events: GameEvent[],
  queries: QueryListener[],
): void {
  // Find the card with actions — search grid units
  let card: Draft<UnitCard> | undefined;

  for (let r = 0; r < draft.grid.length; r++) {
    for (let c = 0; c < draft.grid[r].length; c++) {
      const found = draft.grid[r][c].units.find((u) => u.id === cardId);
      if (found) {
        card = found;
        break;
      }
    }
    if (card) break;
  }

  if (!card) throw new Error(`Card "${cardId}" not found on grid`);
  if (!card.actions) throw new Error(`Card "${cardId}" has no actions`);
  if (card.ownerId !== playerId) throw new Error(`Card "${cardId}" not owned by "${playerId}"`);

  const actionDef = card.actions.find((a) => a.name === actionName);
  if (!actionDef) throw new Error(`Action "${actionName}" not found on card "${cardId}"`);

  spendAP(draft, actionDef.apCost);

  let rng = prand.mersenne.fromState(draft.rngState);
  const result = executeEffect(actionDef.effect, {
    draft,
    playerId,
    actingUnitId: cardId,
    targetId,
    targetCell,
    emit,
    events,
    queries,
    rng,
  });
  draft.rngState = extractRngState(result.rng) as number[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyMainAction(
  state: MainGameState,
  action: MainAction,
): ApplyResult {
  const events: GameEvent[] = [];
  let roundIncremented = false;

  const nextState = produce(state, (draft) => {
    const { listeners, queries } = rebuildListeners(draft as MainGameState);
    const emit: EmitFn = (event) => emitEvent(draft, event, listeners, events);

    switch (action.type) {
      case "pass":
        roundIncremented = endTurnAndAdvance(draft, emit, events);
        break;

      case "deploy":
        handleDeploy(draft, action.playerId, action.cardId, emit, events, queries);
        break;

      case "buy":
        handleBuy(draft, action.playerId, action.cardId, action.costIndex, emit, events, queries);
        break;

      case "draw":
        handleDraw(draft, action.playerId, emit, events);
        break;

      case "enter":
        handleEnter(draft, action.playerId, action.unitId, action.row, action.col, emit);
        break;

      case "move":
        handleMove(draft, action.playerId, action.unitId, action.row, action.col, emit, queries);
        break;

      case "play_event":
        handlePlayEvent(draft, action.playerId, action.cardId, action.targetId, emit, events, queries);
        break;

      case "equip":
        handleEquip(draft, action.playerId, action.itemId, action.unitId, emit);
        break;

      case "destroy":
        handleDestroy(draft, action.playerId, action.cardId, emit);
        break;

      case "raze":
        handleRaze(
          draft, action.playerId, action.unitId,
          action.row, action.col, action.rotation, emit, events,
        );
        break;

      case "attack":
        handleAttack(draft, action.playerId, action.unitIds, action.row, action.col, emit, queries);
        break;

      case "activate":
        handleActivate(
          draft, action.playerId, action.cardId,
          action.actionName, action.targetId,
          action.targetCell,
          emit, events, queries,
        );
        break;

      case "attempt_mission":
        handleAttemptMission(draft, action.playerId, action.row, action.col, emit, events, queries);
        break;

      default: {
        const _exhaustive: never = action;
        throw new Error(
          `Unknown action type: "${(_exhaustive as MainAction).type}"`,
        );
      }
    }

    // Log action after handler — so "first X per turn" queries (countActionsThisTurn)
    // don't count the current action as a prior action during the same handler.
    draft.actionLog.push(castDraft(action));
  });

  // Check win conditions at round boundaries
  if (roundIncremented) {
    if (shouldEndGame(nextState)) {
      const leader = findSoleLeader(nextState);
      if (leader) {
        return { state: toEndedState(nextState, leader, events), events };
      }
      // Tied — per rules, play additional rounds until sole leader.
      // GameController.run() has a maxActions guard (10k) to prevent infinite loops.
    }
    // Game continues — emit turn_started (deferred from advanceTurn at round boundary)
    // and run start-of-turn effects with listener support
    const withTurnStart = produce(nextState, (draft) => {
      const { listeners: ls } = rebuildListeners(draft as MainGameState);
      const emitRound: EmitFn = (event) => emitEvent(draft, event, ls, events);
      emitRound({
        type: "turn_started",
        playerId: draft.turn.activePlayerId,
        round: draft.turn.round,
      });
      runStartOfTurn(draft, emitRound, events);
    });
    return { state: withTurnStart, events };
  }

  return { state: nextState, events };
}
