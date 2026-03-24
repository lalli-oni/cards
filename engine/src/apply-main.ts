import type { Draft } from "immer";
import { produce } from "immer";
import prand from "pure-rand";
import { parseCost, spendAP, spendGold } from "./cost-helpers";
import { drawLocationFromProspect, drawMarketCard, drawOneCard } from "./deck-helpers";
import { checkMissionRequirements, parseMission } from "./mission-helpers";
import {
  areFacingEdgesOpen,
  findUnitOnGrid,
  getBoundaryEdges,
  isOrthogonallyAdjacent,
  isPerimeterCell,
} from "./grid-helpers";
import { extractRngState } from "./rng";
import {
  advanceTurn,
  getConfigNumber,
  getPlayer,
  placeLocationOnGrid,
} from "./state-helpers";
import type {
  ApplyResult,
  GameEvent,
  ItemCard,
  MainAction,
  MainGameState,
  UnitCard,
} from "./types";

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

export function runStartOfTurn(draft: Draft<MainGameState>, events: GameEvent[]): void {
  const player = getPlayer(draft, draft.turn.activePlayerId);

  // Market population — once, when market is empty (first turn of main phase)
  if (draft.market.length === 0) {
    const drawCount = getConfigNumber(draft, "market_draw_count", 3);
    for (const p of draft.players) {
      for (let i = 0; i < drawCount; i++) {
        const card = drawMarketCard(draft, p, events);
        if (card) {
          const slotIndex = draft.market.length;
          draft.market.push(card);
          events.push({
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
  events.push({
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
  for (const card of player.hq) {
    if (card.type === "unit" && (card as UnitCard).injured) {
      (card as UnitCard).injured = false;
      events.push({ type: "unit_healed", playerId: player.id, unitId: card.id });
    }
  }

}

function runEndOfTurn(draft: Draft<MainGameState>, events: GameEvent[]): void {
  const player = getPlayer(draft, draft.turn.activePlayerId);

  // Hand size enforcement
  const maxHandSize = getConfigNumber(draft, "max_hand_size", 7);
  while (player.hand.length > maxHandSize) {
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
  }

  // Passive event duration tracking
  for (let i = player.passiveEvents.length - 1; i >= 0; i--) {
    const evt = player.passiveEvents[i];
    if (evt.remainingDuration != null) {
      evt.remainingDuration -= 1;
      if (evt.remainingDuration <= 0) {
        player.passiveEvents.splice(i, 1);
        player.discardPile.push(evt);
        events.push({ type: "passive_expired", playerId: player.id, cardId: evt.id });
      }
    }
  }
}

/** End the current turn and advance to the next player. */
function endTurnAndAdvance(draft: Draft<MainGameState>, events: GameEvent[]): void {
  events.push({ type: "turn_ended", playerId: draft.turn.activePlayerId });
  runEndOfTurn(draft, events);
  advanceTurn(draft, events);
  runStartOfTurn(draft, events);
}

/** After an AP-spending action, auto-advance if AP exhausted. */
function checkAutoAdvance(draft: Draft<MainGameState>, events: GameEvent[]): void {
  if (draft.turn.actionPointsRemaining <= 0) {
    endTurnAndAdvance(draft, events);
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleDeploy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in player "${playerId}" hand`);
  }

  const card = player.hand[cardIdx];
  if (card.type !== "unit" && card.type !== "item") {
    throw new Error(`Cannot deploy card of type "${card.type}" — only units and items`);
  }

  const cost = parseCost(card.cost);
  spendGold(draft, player, cost, "deploy", events);
  spendAP(draft, 1);

  player.hand.splice(cardIdx, 1);
  player.hq.push(card);

  events.push({ type: "card_deployed", playerId, cardId });
  checkAutoAdvance(draft, events);
}

function handleBuy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  costIndex: number | undefined,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
  const slotIndex = draft.market.findIndex((c) => c.id === cardId);
  if (slotIndex === -1) {
    throw new Error(`Card "${cardId}" not found in market`);
  }

  const card = draft.market[slotIndex];
  const cost = parseCost(card.cost, costIndex);
  spendGold(draft, player, cost, "buy", events);

  // Remove from market and add to hand
  draft.market.splice(slotIndex, 1);
  player.hand.push(card);
  events.push({ type: "card_bought", playerId, cardId, cost });

  // Replenish market slot from active player's market deck
  const replacement = drawMarketCard(draft, player, events);
  if (replacement) {
    draft.market.splice(slotIndex, 0, replacement);
    events.push({
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
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
  spendAP(draft, 1);
  drawOneCard(draft, player, events);
  checkAutoAdvance(draft, events);
}

function handleEnter(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  row: number,
  col: number,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
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

  events.push({ type: "unit_entered", playerId, unitId, row, col });
  checkTraps(draft, playerId, "enemy_unit_enters_location", row, col, unitId, events);
  checkAutoAdvance(draft, events);
}

function handleMove(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  toRow: number,
  toCol: number,
  events: GameEvent[],
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

    const apCost = unit.injured
      ? 1 + getConfigNumber(draft, "injury_move_penalty", 1)
      : 1;
    spendAP(draft, apCost);

    const cell = draft.grid[fromRow][fromCol];
    const idx = cell.units.findIndex((u) => u.id === unitId);
    if (idx === -1) {
      throw new Error(`Unit "${unitId}" not found at (${fromRow},${fromCol}) during retreat`);
    }
    const removed = cell.units.splice(idx, 1)[0];
    const player = getPlayer(draft, playerId);
    player.hq.push(removed);

    events.push({
      type: "unit_moved",
      playerId,
      unitId,
      fromRow,
      fromCol,
      toRow: -1,
      toCol: -1,
    });
    checkAutoAdvance(draft, events);
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

  events.push({ type: "unit_moved", playerId, unitId, fromRow, fromCol, toRow, toCol });
  checkTraps(draft, playerId, "enemy_unit_enters_location", toRow, toCol, unitId, events);
  checkAutoAdvance(draft, events);
}

function handlePlayEvent(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  targetId: string | undefined,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
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
    case "instant":
      // Effect resolution deferred — for now just discard
      player.discardPile.push(card);
      events.push({ type: "event_played", playerId, cardId });
      break;

    case "passive":
      card.remainingDuration = card.duration ?? 1;
      player.passiveEvents.push(card);
      events.push({ type: "event_played", playerId, cardId });
      break;

    case "trap":
      player.activeTraps.push({ card, targetId });
      events.push({ type: "trap_set", playerId, cardId, targetId });
      break;

    default: {
      const _exhaustive: never = card.subtype;
      throw new Error(`Unknown event subtype "${_exhaustive}" for card "${cardId}"`);
    }
  }

  checkAutoAdvance(draft, events);
}

function handleEquip(
  draft: Draft<MainGameState>,
  playerId: string,
  itemId: string,
  unitId: string,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);

  // Find item — could be in HQ or on grid
  let item: Draft<ItemCard> | null = null;
  let itemLocation: "hq" | { row: number; col: number } | null = null;

  const hqItem = player.hq.find((c) => c.id === itemId && c.type === "item");
  if (hqItem) {
    item = hqItem as Draft<ItemCard>;
    itemLocation = "hq";
  } else {
    for (let r = 0; r < draft.grid.length; r++) {
      for (let c = 0; c < draft.grid[r].length; c++) {
        const gridItem = draft.grid[r][c].items.find((i) => i.id === itemId);
        if (gridItem) {
          item = gridItem;
          itemLocation = { row: r, col: c };
          break;
        }
      }
      if (item) break;
    }
  }

  if (!item || !itemLocation) {
    throw new Error(`Item "${itemId}" not found in HQ or on grid`);
  }

  // Find unit — must be co-located with item
  let unitFound = false;
  if (itemLocation === "hq") {
    unitFound = player.hq.some((c) => c.id === unitId && c.type === "unit");
  } else {
    const cell = draft.grid[itemLocation.row][itemLocation.col];
    unitFound = cell.units.some((u) => u.id === unitId);
  }

  if (!unitFound) {
    throw new Error(
      `Unit "${unitId}" not co-located with item "${itemId}"`,
    );
  }

  spendAP(draft, 1);

  // Unequip from previous unit if any
  if (item.equippedTo) {
    item.equippedTo = undefined;
  }

  item.equippedTo = unitId;
  events.push({ type: "item_equipped", playerId, itemId, unitId });
  checkAutoAdvance(draft, events);
}

function handleDestroy(
  draft: Draft<MainGameState>,
  playerId: string,
  cardId: string,
  events: GameEvent[],
): void {
  const player = getPlayer(draft, playerId);
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in player "${playerId}" hand`);
  }

  spendAP(draft, 1);
  const card = player.hand.splice(cardIdx, 1)[0];
  player.removedFromGame.push(card);

  events.push({ type: "card_destroyed", playerId, cardId });
  checkAutoAdvance(draft, events);
}

function handleRaze(
  draft: Draft<MainGameState>,
  playerId: string,
  unitId: string,
  row: number,
  col: number,
  rotation: number | undefined,
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
    const owner = getPlayer(draft, u.ownerId);
    owner.discardPile.push(u);
  }
  cell.units = [];

  // Discard all items at location
  for (const item of cell.items) {
    const owner = getPlayer(draft, item.ownerId);
    owner.discardPile.push(item);
  }
  cell.items = [];

  // Discard the location
  const player = getPlayer(draft, playerId);
  player.discardPile.push(cell.location);
  cell.location = null;

  events.push({ type: "location_razed", row, col, cardId: razedLocationId });

  // Draw replacement location from prospect deck
  const newLocation = drawLocationFromProspect(draft, player, events);
  if (newLocation) {
    placeLocationOnGrid(draft, newLocation, row, col, rotation);
    events.push({ type: "location_placed", row, col, cardId: newLocation.id });
  }

  checkAutoAdvance(draft, events);
}

function handleAttack(
  draft: Draft<MainGameState>,
  playerId: string,
  unitIds: string[],
  row: number,
  col: number,
  events: GameEvent[],
): void {
  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location`);
  }

  if (unitIds.length === 0) {
    throw new Error("Must commit at least one unit to attack");
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

  events.push({ type: "combat_started", row, col, attackerId: playerId, defenderId });

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
      const strength = u.injured ? Math.max(0, u.strength - getConfigNumber(draft, "injury_stat_penalty", 1)) : u.strength;
      atkRolls.push({ unit: u, power: strength + roll });
    }

    const defRolls: { unit: Draft<UnitCard>; power: number }[] = [];
    for (const u of livingDefenders) {
      const [roll, nextRng] = prand.uniformIntDistribution(1, 6, rng);
      rng = nextRng;
      const strength = u.injured ? Math.max(0, u.strength - getConfigNumber(draft, "injury_stat_penalty", 1)) : u.strength;
      defRolls.push({ unit: u, power: strength + roll });
    }

    // Sort by power descending, pair highest vs highest
    atkRolls.sort((a, b) => b.power - a.power);
    defRolls.sort((a, b) => b.power - a.power);

    const pairs = Math.min(atkRolls.length, defRolls.length);
    for (let i = 0; i < pairs; i++) {
      const atk = atkRolls[i];
      const def = defRolls[i];
      resolveCombatPair(draft, cell, atk, def, row, col, events);
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

  events.push({ type: "combat_resolved", row, col, winnerId });
  checkAutoAdvance(draft, events);
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
  events: GameEvent[],
): void {
  if (atk.power === def.power) return; // tie — nothing happens

  const winner = atk.power > def.power ? atk : def;
  const loser = atk.power > def.power ? def : atk;
  const killRatio = getConfigNumber(draft, "combat_kill_ratio", 2);
  const isKill = winner.power >= killRatio * loser.power;

  if (isKill || loser.unit.injured) {
    // Kill: remove unit from grid, drop items, send to owner's discard
    killUnit(draft, cell, loser.unit, row, col, events);
  } else {
    // Injure
    loser.unit.injured = true;
    // Drop equipped items at location
    dropEquippedItems(cell, loser.unit, row, col, events);
    events.push({ type: "unit_injured", unitId: loser.unit.id, ownerId: loser.unit.ownerId });
  }
}

/** Kill a unit: remove from grid, drop items, send to owner's discard. */
function killUnit(
  draft: Draft<MainGameState>,
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  events: GameEvent[],
): void {
  // Drop equipped items first
  dropEquippedItems(cell, unit, row, col, events);

  // Remove from cell
  const idx = cell.units.findIndex((u) => u.id === unit.id);
  if (idx !== -1) {
    cell.units.splice(idx, 1);
  }

  // Send to owner's discard pile
  const owner = getPlayer(draft, unit.ownerId);
  owner.discardPile.push(unit);

  events.push({ type: "unit_killed", unitId: unit.id, ownerId: unit.ownerId });
}

/** Drop all items equipped to a unit at the unit's location. */
function dropEquippedItems(
  cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
  unit: Draft<UnitCard>,
  row: number,
  col: number,
  events: GameEvent[],
): void {
  // Find items equipped to this unit (could be in cell.items or HQ items)
  for (const item of cell.items) {
    if (item.equippedTo === unit.id) {
      item.equippedTo = undefined;
      events.push({ type: "item_dropped", itemId: item.id, row, col });
    }
  }
}

// ---------------------------------------------------------------------------
// Trap auto-trigger
// ---------------------------------------------------------------------------

function checkTraps(
  draft: Draft<MainGameState>,
  playerId: string,
  triggerType: string,
  row: number,
  col: number,
  unitId: string,
  events: GameEvent[],
): void {
  const location = draft.grid[row]?.[col]?.location;

  for (const player of draft.players) {
    if (player.id === playerId) continue; // only enemy traps fire
    for (let i = player.activeTraps.length - 1; i >= 0; i--) {
      const trap = player.activeTraps[i];
      if (trap.card.trigger !== triggerType) continue;
      // If trap has a targetId, it must match the location at (row, col)
      if (trap.targetId && location && trap.targetId !== location.id) continue;

      resolveTrapEffect(draft, trap, unitId, row, col, events);

      // Discard the trap
      player.activeTraps.splice(i, 1);
      player.discardPile.push(trap.card);
      events.push({
        type: "trap_triggered",
        playerId: player.id,
        cardId: trap.card.id,
        targetId: trap.targetId,
      });
    }
  }
}

function resolveTrapEffect(
  draft: Draft<MainGameState>,
  trap: Draft<{ card: { definitionId: string } }>,
  unitId: string,
  row: number,
  col: number,
  events: GameEvent[],
): void {
  const cell = draft.grid[row][col];
  const unit = cell.units.find((u) => u.id === unitId);
  if (!unit) return;

  switch (trap.card.definitionId) {
    case "ambush":
      if (unit.injured) {
        killUnit(draft, cell, unit, row, col, events);
      } else {
        unit.injured = true;
        dropEquippedItems(cell, unit, row, col, events);
        events.push({ type: "unit_injured", unitId: unit.id, ownerId: unit.ownerId });
      }
      break;

    case "assassination-attempt":
      if (unit.strength <= 6) {
        killUnit(draft, cell, unit, row, col, events);
      } else if (unit.injured) {
        killUnit(draft, cell, unit, row, col, events);
      } else {
        unit.injured = true;
        dropEquippedItems(cell, unit, row, col, events);
        events.push({ type: "unit_injured", unitId: unit.id, ownerId: unit.ownerId });
      }
      break;

    case "sabotage":
      // Action already resolved — no-op for v0.1
      break;

    default:
      throw new Error(
        `No trap resolution logic for definitionId "${trap.card.definitionId}"`,
      );
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
  events: GameEvent[],
): void {
  const cell = draft.grid[row][col];
  if (!cell.location) {
    throw new Error(`Cell (${row},${col}) has no location`);
  }
  if (!cell.location.mission) {
    throw new Error(`Location at (${row},${col}) has no mission`);
  }

  const friendlyUnits = cell.units.filter((u) => u.ownerId === playerId);
  if (friendlyUnits.length === 0) {
    throw new Error(`No friendly units at (${row},${col})`);
  }

  spendAP(draft, 1);

  const { requirements, vp } = parseMission(cell.location.mission);

  if (!checkMissionRequirements(requirements, friendlyUnits)) {
    // Mission not met — no penalty, attempt ends
    checkAutoAdvance(draft, events);
    return;
  }

  const player = getPlayer(draft, playerId);
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

  // Location → completing player's discard
  player.discardPile.push(cell.location);
  cell.location = null;

  events.push({ type: "mission_completed", playerId, locationId, vp });

  // Draw replacement location from prospect deck
  const newLocation = drawLocationFromProspect(draft, player, events);
  if (newLocation) {
    placeLocationOnGrid(draft, newLocation, row, col);
    events.push({ type: "location_placed", row, col, cardId: newLocation.id });
  }

  checkAutoAdvance(draft, events);
}

function handleActivate(
  _draft: Draft<MainGameState>,
  _playerId: string,
  _cardId: string,
  _actionName: string,
  _targetId: string | undefined,
  _events: GameEvent[],
): void {
  // Stub — effect resolution deferred to issue #20
  throw new Error(
    "activate action is not yet implemented — waiting on stat contest mechanics (#20)",
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyMainAction(
  state: MainGameState,
  action: MainAction,
): ApplyResult {
  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    draft.actionLog.push(action);

    switch (action.type) {
      case "pass":
        endTurnAndAdvance(draft, events);
        break;

      case "deploy":
        handleDeploy(draft, action.playerId, action.cardId, events);
        break;

      case "buy":
        handleBuy(draft, action.playerId, action.cardId, action.costIndex, events);
        break;

      case "draw":
        handleDraw(draft, action.playerId, events);
        break;

      case "enter":
        handleEnter(draft, action.playerId, action.unitId, action.row, action.col, events);
        break;

      case "move":
        handleMove(draft, action.playerId, action.unitId, action.row, action.col, events);
        break;

      case "play_event":
        handlePlayEvent(draft, action.playerId, action.cardId, action.targetId, events);
        break;

      case "equip":
        handleEquip(draft, action.playerId, action.itemId, action.unitId, events);
        break;

      case "destroy":
        handleDestroy(draft, action.playerId, action.cardId, events);
        break;

      case "raze":
        handleRaze(
          draft, action.playerId, action.unitId,
          action.row, action.col, action.rotation, events,
        );
        break;

      case "attack":
        handleAttack(draft, action.playerId, action.unitIds, action.row, action.col, events);
        break;

      case "activate":
        handleActivate(
          draft, action.playerId, action.cardId,
          action.actionName, action.targetId, events,
        );
        break;

      case "attempt_mission":
        handleAttemptMission(draft, action.playerId, action.row, action.col, events);
        break;

      default: {
        const _exhaustive: never = action;
        throw new Error(
          `Unknown action type: "${(_exhaustive as MainAction).type}"`,
        );
      }
    }
  });

  return { state: nextState, events };
}
