import type { Draft } from "immer";
import { castDraft, produce } from "immer";
import { fromState, uniformIntDistribution } from "./rng";
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
import { getModifiedStatWithSources, getModifiedCost, getModifiedAPCost } from "./listeners/query";
import type { EmitFn, QueryListener } from "./listeners/types";
import { needsLocationTarget } from "./valid-actions";
import { killUnit, injureUnit, dropEquippedItems } from "./unit-helpers";
import type {
  ActionDef,
  ActivePassiveEvent,
  ApplyResult,
  CombatPairOutcome,
  CombatSide,
  GameEvent,
  ItemCard,
  MainAction,
  ModifierEntry,
  ModifierSource,
  MainGameState,
  UnitCard,
} from "./types";
import { POLICY_ACTIONS } from "./listeners/effects";
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
        // Control override — revert to the controller that held the unit
        // just before this cast. For a stolen-then-controlled unit this is
        // the thief, not the original drafter; for a nested control it is
        // the outer caster.
        if (unit.controlOverride) {
          unit.controlOverride.remainingDuration -= 1;
          if (unit.controlOverride.remainingDuration <= 0) {
            unit.controllerId = unit.controlOverride.previousControllerId;
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

  // Remove from market and add to hand. The buyer becomes the controller —
  // ownerId stays (market cards seed with "neutral") so end-of-game return
  // mechanics retain the original provenance.
  draft.market.splice(slotIndex, 1);
  card.controllerId = playerId;
  player.hand.push(card);
  emit({ type: "card_bought", playerId, cardId, cardName: card.name, cost });

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
  if (unit.controllerId !== playerId) {
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

  const baseApCost = unit.injured
    ? 1 + getConfigNumber(draft, "injury_move_penalty", 1)
    : 1;
  const apCost = getModifiedAPCost(
    draft as MainGameState, queries,
    { type: "move", playerId, unitId, row: toRow, col: toCol }, baseApCost,
  );
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
  if (needsLocationTarget(card) && targetId == null) {
    throw new Error(
      `Card "${cardId}" (${card.definitionId}) requires a location targetId`,
    );
  }

  const cost = parseCost(card.cost);
  spendGold(draft, player, cost, "play_event", events);
  const apCost = getModifiedAPCost(
    draft as MainGameState, queries,
    { type: "play_event", playerId, cardId, targetId }, 1,
  );
  spendAP(draft, apCost);

  player.hand.splice(cardIdx, 1);

  switch (card.subtype) {
    case "instant": {
      if (card.effect) {
        let rng = fromState(draft.rngState);
        const result = executeEffect(card.effect, {
          draft, playerId, emit,
          events, queries,
          rng,
          targetId,
          actingCardSource: {
            type: "event",
            cardId: card.id,
            definitionId: card.definitionId,
          },
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
  if (unit.controllerId !== playerId) {
    throw new Error(`Unit "${unitId}" is not owned by player "${playerId}"`);
  }

  // No enemy units allowed
  const hasEnemyUnits = cell.units.some((u) => u.controllerId !== playerId);
  if (hasEnemyUnits) {
    throw new Error(`Cannot raze — enemy units present at (${row},${col})`);
  }

  const razeCost = getConfigNumber(draft, "raze_ap_cost", 3);
  spendAP(draft, razeCost);

  const razedLocationId = cell.location.id;

  // Discard razed cards to whichever player currently controls them. For a
  // friendly raze this collapses to the razer; for a bought/stolen unit that
  // was at the location, the controller (not the original owner) collects it.
  for (const u of cell.units) {
    const owner = getPlayerById(draft, u.controllerId);
    owner.discardPile.push(u);
  }
  cell.units = [];

  for (const item of cell.items) {
    const owner = getPlayerById(draft, item.controllerId);
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
    if (unit.controllerId !== playerId) {
      throw new Error(`Unit "${uid}" is not owned by player "${playerId}"`);
    }
    attackers.push(unit);
  }

  // Find defender(s) — all enemy units at location
  const defenders = cell.units.filter((u) => u.controllerId !== playerId);
  if (defenders.length === 0) {
    throw new Error(`No enemy units at cell (${row},${col}) to attack`);
  }

  const defenderId = defenders[0].controllerId;
  spendAP(draft, 1);

  emit({ type: "combat_started", row, col, attackerId: playerId, defenderId });

  let rng = fromState(draft.rngState);

  // Auto-resolve combat rounds
  const maxRounds = 10; // safety limit
  for (let round = 0; round < maxRounds; round++) {
    const livingAttackers = attackers.filter((u) => !isDeadOrRemoved(cell, u));
    const livingDefenders = defenders.filter((u) => !isDeadOrRemoved(cell, u));

    if (livingAttackers.length === 0 || livingDefenders.length === 0) break;

    const injuryPenalty = getConfigNumber(draft, "injury_stat_penalty", 1);

    const atkRolls: CombatantRoll[] = [];
    for (const u of livingAttackers) {
      const [roll, nextRng] = uniformIntDistribution(1, 6, rng);
      rng = nextRng;
      atkRolls.push(buildCombatantRoll(draft, queries, u, "attacker", row, col, roll, injuryPenalty));
    }

    const defRolls: CombatantRoll[] = [];
    for (const u of livingDefenders) {
      const [roll, nextRng] = uniformIntDistribution(1, 6, rng);
      rng = nextRng;
      defRolls.push(buildCombatantRoll(draft, queries, u, "defender", row, col, roll, injuryPenalty));
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

interface CombatantRoll {
  unit: Draft<UnitCard>;
  baseStrength: number;
  modifiers: ModifierEntry[];
  roll: number;
  power: number;
  injuredBefore: boolean;
}

function buildCombatantRoll(
  draft: Draft<MainGameState>,
  queries: QueryListener[],
  unit: Draft<UnitCard>,
  role: "attacker" | "defender",
  row: number,
  col: number,
  roll: number,
  injuryPenalty: number,
): CombatantRoll {
  const breakdown = getModifiedStatWithSources(
    draft as MainGameState,
    queries,
    unit as UnitCard,
    "strength",
    { row, col },
    { role, row, col },
  );
  const injuredBefore = unit.injured;
  const modifiers: ModifierEntry[] = [...breakdown.modifiers];
  if (injuredBefore && injuryPenalty !== 0) {
    // Synthesize a `definitionId: "injured"` source so the breakdown chip
    // reads "injured" rather than the unit name. `cardId` stays as the
    // unit instance for downstream tooltip resolution.
    modifiers.push({
      source: { type: "unit", cardId: unit.id, definitionId: "injured" },
      delta: -injuryPenalty,
    });
  }
  const sum = modifiers.reduce((acc, m) => acc + m.delta, 0);
  const clampedFloor = breakdown.base + sum;
  if (clampedFloor < 0) {
    // Clamping `strength` to 0 means `base + Σmods + roll !== power`. Surface
    // the clamp as a synthetic modifier so the displayed math reconciles.
    modifiers.push({
      source: { type: "unit", cardId: unit.id, definitionId: "clamped" },
      delta: -clampedFloor,
    });
  }
  const strength = Math.max(0, clampedFloor);
  return {
    unit,
    baseStrength: breakdown.base,
    modifiers,
    roll,
    power: strength + roll,
    injuredBefore,
  };
}

function toCombatSide(c: CombatantRoll): CombatSide {
  return {
    unitId: c.unit.id,
    baseStrength: c.baseStrength,
    modifiers: c.modifiers,
    roll: c.roll,
    power: c.power,
    injuredBefore: c.injuredBefore,
  };
}

/** Pure — derives the pair outcome from rolled powers + kill ratio. Equal
 *  powers resolve to the defender (rules/stat-contests.md: "Ties go to the
 *  defender") — the attacker is the loser, so a tie yields injure_attacker, or
 *  kill_attacker if the attacker was already injured. Exported so the decision
 *  can be unit-tested without RNG plumbing. `"tie"` is retained on
 *  CombatPairOutcome as forward-compat for a future Resolute keyword. */
export function deriveCombatOutcome(
  atkPower: number,
  defPower: number,
  atkInjured: boolean,
  defInjured: boolean,
  killRatio: number,
): CombatPairOutcome {
  const attackerWins = atkPower > defPower;
  const winnerPower = attackerWins ? atkPower : defPower;
  const loserPower = attackerWins ? defPower : atkPower;
  const loserInjured = attackerWins ? defInjured : atkInjured;
  const isKill = winnerPower >= killRatio * loserPower;
  const loserKilled = isKill || loserInjured;
  return attackerWins
    ? (loserKilled ? "kill_defender" : "injure_defender")
    : (loserKilled ? "kill_attacker" : "injure_attacker");
}

/** Resolve a single 1v1 combat pair. */
function resolveCombatPair(
  draft: Draft<MainGameState>,
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  atk: CombatantRoll,
  def: CombatantRoll,
  row: number,
  col: number,
  emit: EmitFn,
): void {
  const attackerSide = toCombatSide(atk);
  const defenderSide = toCombatSide(def);
  const attackerPlayerId = atk.unit.controllerId;
  const defenderPlayerId = def.unit.controllerId;
  const killRatio = getConfigNumber(draft, "combat_kill_ratio", 2);
  const outcome = deriveCombatOutcome(
    atk.power,
    def.power,
    atk.unit.injured,
    def.unit.injured,
    killRatio,
  );

  const attackerWins = atk.power > def.power;
  const loser = attackerWins ? def : atk;
  const loserKilled = outcome === "kill_attacker" || outcome === "kill_defender";

  emit({
    type: "combat_pair_resolved",
    row, col,
    attackerPlayerId, defenderPlayerId,
    attacker: attackerSide,
    defender: defenderSide,
    outcome,
  });

  if (loserKilled) {
    // Kill: remove unit from grid, drop items, send to owner's discard
    killUnit(draft, cell, loser.unit, row, col, emit);
  } else {
    // Combat-specific: drop equipped items before marking injured. Other
    // injure sources (DSL injure, traps, contest default consequence) leave
    // equipment in place — see injureUnit doc.
    dropEquippedItems(cell, loser.unit, row, col, emit);
    injureUnit(loser.unit, emit);
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

  const friendlyUnits = cell.units.filter((u) => u.controllerId === playerId);
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
  // HQ units only surface non-positional activates (see valid-actions.ts's
  // isHqSafeVerb gate); positional verbs no-op cleanly when actingUnitId
  // resolves to no grid position (see executor's getActingPosition).
  const located = findUnitPosition(draft.players, draft.grid, cardId);
  let actionDef: ActionDef | undefined;
  let actingUnitId: string | undefined = cardId;
  let cardName: string;
  let actingCardSource: ModifierSource;

  if (located) {
    const card = located.unit as Draft<UnitCard>;
    if (!card.actions) throw new Error(`Card "${cardId}" has no actions`);
    if (card.controllerId !== playerId) throw new Error(`Card "${cardId}" not owned by "${playerId}"`);
    actionDef = card.actions.find((a) => a.name === actionName);
    if (!actionDef) throw new Error(`Action "${actionName}" not found on unit "${cardId}"`);
    cardName = card.name;
    actingCardSource = { type: "unit", cardId: card.id, definitionId: card.definitionId };
  } else {
    // Not a unit — try active policies.
    const owner = draft.players.find((p) => p.id === playerId);
    const policy = owner?.activePolicies.find((p) => p.id === cardId);
    if (!policy) throw new Error(`Card "${cardId}" not found on grid, HQ, or active policies`);
    const policyActions = POLICY_ACTIONS[policy.definitionId];
    if (!policyActions) {
      throw new Error(
        `Policy "${policy.definitionId}" (id="${cardId}") has no actions registered in POLICY_ACTIONS`,
      );
    }
    actionDef = policyActions.find((a) => a.name === actionName);
    if (!actionDef) throw new Error(`Action "${actionName}" not found on policy "${cardId}"`);
    actingUnitId = undefined;
    cardName = policy.name;
    actingCardSource = { type: "policy", cardId: policy.id, definitionId: policy.definitionId };
  }

  if (targetId !== undefined && targetCell !== undefined) {
    throw new Error(
      `Activate accepts at most one of targetId/targetCell (card "${cardId}", action "${actionName}")`,
    );
  }
  if (targetCell !== undefined) {
    const gridRows = draft.grid.length;
    const gridCols = draft.grid[0].length;
    if (
      targetCell.row < 0 || targetCell.row >= gridRows ||
      targetCell.col < 0 || targetCell.col >= gridCols
    ) {
      throw new Error(
        `Activate targetCell (${targetCell.row},${targetCell.col}) is outside grid bounds ${gridRows}x${gridCols}`,
      );
    }
  }
  const target =
    targetId !== undefined
      ? ({ kind: "card", id: targetId } as const)
      : targetCell !== undefined
        ? ({ kind: "cell", row: targetCell.row, col: targetCell.col } as const)
        : undefined;

  emit({
    type: "card_activated",
    playerId,
    cardId,
    cardName,
    actionName,
    target,
  });

  spendAP(draft, actionDef.apCost);

  let rng = fromState(draft.rngState);
  const result = executeEffect(actionDef.effect, {
    draft,
    playerId,
    actingUnitId,
    actingCardSource,
    targetId,
    targetCell,
    emit,
    events,
    queries,
    rng,
  });
  draft.rngState = extractRngState(result.rng) as number[];
}

function handleResolvePick(
  draft: Draft<MainGameState>,
  playerId: string,
  pickedCardIds: string[],
  emit: EmitFn,
): void {
  const submitted = `submitted ids=[${pickedCardIds.join(",")}] by player "${playerId}"`;
  const prompt = draft.pickPrompt;
  if (!prompt) {
    throw new Error(`resolve_pick rejected: no pending pick (${submitted})`);
  }
  if (prompt.playerId !== playerId) {
    throw new Error(
      `resolve_pick rejected: pending pick is for "${prompt.playerId}", not "${playerId}" (${submitted})`,
    );
  }
  if (prompt.kind !== "deck_pick") {
    throw new Error(
      `resolve_pick rejected: main-phase handler only supports "deck_pick" prompts (got "${prompt.kind}")`,
    );
  }
  if (pickedCardIds.length !== prompt.count) {
    throw new Error(
      `resolve_pick rejected: expected ${prompt.count} cards, got ${pickedCardIds.length} (${submitted})`,
    );
  }
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of pickedCardIds) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  if (dupes.length > 0) {
    throw new Error(
      `resolve_pick rejected: duplicate card ids [${dupes.join(",")}] (${submitted})`,
    );
  }
  const candidates = new Set(prompt.options);
  for (const id of pickedCardIds) {
    if (!candidates.has(id)) {
      throw new Error(
        `resolve_pick rejected: card "${id}" was not revealed (${submitted}, options=[${prompt.options.join(",")}])`,
      );
    }
  }

  const player = getPlayerById(draft, playerId);
  for (const id of pickedCardIds) {
    const idx = player.mainDeck.findIndex((c) => c.id === id);
    if (idx === -1) {
      throw new Error(
        `resolve_pick: card "${id}" no longer in deck — invariant broken (${submitted})`,
      );
    }
    const [card] = player.mainDeck.splice(idx, 1);
    player.hand.push(card);
  }
  emit({
    type: "cards_picked",
    playerId,
    cardIds: pickedCardIds,
    source: prompt.source,
  });
  draft.pickPrompt = undefined;
}

function handleDismissView(
  draft: Draft<MainGameState>,
  playerId: string,
): void {
  const prompt = draft.viewPrompt;
  if (!prompt) {
    throw new Error(`dismiss_view rejected: no pending view (by player "${playerId}")`);
  }
  if (prompt.playerId !== playerId) {
    throw new Error(
      `dismiss_view rejected: pending view is for "${prompt.playerId}", not "${playerId}"`,
    );
  }
  draft.viewPrompt = undefined;
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

  // Invariant: pickPrompt and viewPrompt are mutually exclusive. The
  // executor's suspend guard in `effect-dsl/executor.ts` ensures producers
  // never co-set them, but assert here so a future producer that bypasses the
  // executor (e.g. a listener mutating state directly) fails loud instead of
  // deadlocking the dispatcher.
  if (state.pickPrompt && state.viewPrompt) {
    throw new Error(
      `applyMainAction invariant: both pickPrompt and viewPrompt are set ` +
        `(picker="${state.pickPrompt.playerId}", viewer="${state.viewPrompt.playerId}") — ` +
        `at most one prompt may be pending at a time`,
    );
  }

  if (state.pickPrompt && action.type !== "resolve_pick") {
    throw new Error(
      `Action "${action.type}" by "${action.playerId}" rejected: ` +
        `pending pick must be resolved first ` +
        `(picker="${state.pickPrompt.playerId}", kind="${state.pickPrompt.kind}", ` +
        `options=[${state.pickPrompt.options.join(",")}])`,
    );
  }

  if (state.viewPrompt && action.type !== "dismiss_view") {
    throw new Error(
      `Action "${action.type}" by "${action.playerId}" rejected: ` +
        `pending view must be dismissed first ` +
        `(viewer="${state.viewPrompt.playerId}", source="${state.viewPrompt.source}", ` +
        `sourcePlayerId="${state.viewPrompt.sourcePlayerId}")`,
    );
  }

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

      case "resolve_pick":
        handleResolvePick(draft, action.playerId, action.pickedCardIds, emit);
        break;

      case "dismiss_view":
        handleDismissView(draft, action.playerId);
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
