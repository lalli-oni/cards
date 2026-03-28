import { tryParseCost } from "./cost-helpers";
import { checkMissionRequirements, parseRequirements } from "./mission-helpers";
import type { BoardPosition } from "./position-helpers";
import { getItemsAtPosition, getUnitsAtPosition } from "./position-helpers";
import {
  areFacingEdgesOpen,
  getAdjacentCells,
  getBoundaryEdges,
  isFull,
  isPerimeterCell,
} from "./grid-helpers";
import { getConfigNumber, getPlayerById } from "./state-helpers";
import { rebuildListeners } from "./listeners/rebuild";
import { getModifiedCost, getModifiedAPCost } from "./listeners/query";
import type {
  Action,
  GameState,
  MainAction,
  MainGameState,
  SeedingAction,
  SeedingGameState,
} from "./types";
import { getActivePlayerId } from "./types";

/**
 * Return all legal actions for a player given the current state.
 * Used by clients (to show available moves) and bots (to choose a move).
 */
export function getValidActions(state: GameState, playerId: string): Action[] {
  if (state.phase === "ended") {
    return [];
  }

  const activePlayerId = getActivePlayerId(state);
  if (activePlayerId !== playerId) {
    return [];
  }

  if (state.phase === "seeding") {
    return getSeedingValidActions(state, playerId);
  }

  return getMainValidActions(state as MainGameState, playerId);
}

// ---------------------------------------------------------------------------
// Seeding phase
// ---------------------------------------------------------------------------

function getSeedingValidActions(
  state: SeedingGameState,
  playerId: string,
): SeedingAction[] {
  const seeding = state.seedingState;

  switch (seeding.step) {
    case "seed_draw":
      return [{ type: "seed_draw", playerId }];

    case "seed_keep":
      return [{ type: "seed_keep", playerId, keepIds: [], exposeIds: [] }];

    case "seed_steal": {
      const actions: SeedingAction[] = [];
      const gridIsFull = isFull(state.grid);
      for (const card of seeding.middleArea) {
        if (card.type === "location" && !gridIsFull) {
          for (let r = 0; r < state.grid.length; r++) {
            for (let c = 0; c < state.grid[r].length; c++) {
              if (state.grid[r][c].location === null) {
                actions.push({
                  type: "seed_steal",
                  playerId,
                  cardId: card.id,
                  row: r,
                  col: c,
                });
              }
            }
          }
        } else {
          actions.push({ type: "seed_steal", playerId, cardId: card.id });
        }
      }
      return actions;
    }

    case "seed_place_location": {
      const plPlayer = state.players.find((p) => p.id === playerId);
      if (!plPlayer?.prospectDeck.some((c) => c.type === "location")) return [];
      const actions: SeedingAction[] = [];
      for (let r = 0; r < state.grid.length; r++) {
        for (let c = 0; c < state.grid[r].length; c++) {
          if (state.grid[r][c].location === null) {
            actions.push({
              type: "seed_place_location",
              playerId,
              row: r,
              col: c,
            });
          }
        }
      }
      return actions;
    }

    case "policy_selection":
      return [{ type: "policy_select", playerId }];
  }
}

// ---------------------------------------------------------------------------
// Main phase
// ---------------------------------------------------------------------------

function getMainValidActions(
  state: MainGameState,
  playerId: string,
): MainAction[] {
  const actions: MainAction[] = [];
  const player = getPlayerById(state, playerId);
  const ap = state.turn.actionPointsRemaining;
  const gridRows = state.grid.length;
  const gridCols = state.grid[0].length;
  const { queries } = rebuildListeners(state);

  // pass — always available
  actions.push({ type: "pass", playerId });

  // deploy — units/items in hand that player can afford (1 AP)
  if (ap >= 1) {
    for (const card of player.hand) {
      if (card.type === "unit" || card.type === "item") {
        const cost = getModifiedCost(state, queries, card, playerId, "deploy");
        if (player.gold >= cost) {
          actions.push({ type: "deploy", playerId, cardId: card.id });
        }
      }
    }
  }

  // buy — cards in market that player can afford (0 AP)
  for (const card of state.market) {
    if (!card) continue;
    const costs = card.cost.split("|");
    for (let ci = 0; ci < costs.length; ci++) {
      const baseCost = tryParseCost(card.cost, ci);
      if (baseCost === null) continue;
      const cost = getModifiedCost(state, queries, card, playerId, "buy", ci);
      if (player.gold >= cost) {
        actions.push({
          type: "buy",
          playerId,
          cardId: card.id,
          costIndex: costs.length > 1 ? ci : undefined,
        });
      }
    }
  }

  // draw — if AP available and there are cards to draw
  if (ap >= 1 && (player.mainDeck.length > 0 || player.discardPile.length > 0)) {
    actions.push({ type: "draw", playerId });
  }

  // destroy — any card in hand (1 AP)
  if (ap >= 1) {
    for (const card of player.hand) {
      actions.push({ type: "destroy", playerId, cardId: card.id });
    }
  }

  // enter — units in HQ to perimeter cells with open boundary edge (1 AP)
  if (ap >= 1) {
    const hqUnits = player.hq.filter((c) => c.type === "unit");
    for (const unit of hqUnits) {
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (!isPerimeterCell(gridRows, gridCols, r, c)) continue;
          const cell = state.grid[r][c];
          if (!cell.location) continue;
          const boundaryEdges = getBoundaryEdges(r, c, gridRows, gridCols);
          if (boundaryEdges.some((edge) => cell.location!.edges[edge])) {
            actions.push({ type: "enter", playerId, unitId: unit.id, row: r, col: c });
          }
        }
      }
    }
  }

  // move — units on grid to adjacent cells with open facing edges (1 AP, 2 if injured)
  // Also retreat to HQ from perimeter
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      for (const unit of state.grid[r][c].units) {
        if (unit.ownerId !== playerId) continue;
        const baseMoveCost = unit.injured
          ? 1 + getConfigNumber(state, "injury_move_penalty", 1)
          : 1;

        // Move to adjacent cells
        for (const adj of getAdjacentCells(gridRows, gridCols, r, c)) {
          if (
            state.grid[adj.row][adj.col].location &&
            areFacingEdgesOpen(state.grid, r, c, adj.row, adj.col)
          ) {
            const moveAction: MainAction = { type: "move", playerId, unitId: unit.id, row: adj.row, col: adj.col };
            const moveCost = getModifiedAPCost(state, queries, moveAction, baseMoveCost);
            if (ap >= moveCost) {
              actions.push(moveAction);
            }
          }
        }

        // Retreat to HQ from perimeter
        if (isPerimeterCell(gridRows, gridCols, r, c)) {
          const boundaryEdges = getBoundaryEdges(r, c, gridRows, gridCols);
          const loc = state.grid[r][c].location;
          if (loc && boundaryEdges.some((edge) => loc.edges[edge])) {
            const retreatAction: MainAction = { type: "move", playerId, unitId: unit.id, row: -1, col: -1 };
            const retreatCost = getModifiedAPCost(state, queries, retreatAction, baseMoveCost);
            if (ap >= retreatCost) {
              actions.push(retreatAction);
            }
          }
        }
      }
    }
  }

  // play_event — events in hand that player can afford (1 AP)
  if (ap >= 1) {
    for (const card of player.hand) {
      if (card.type !== "event") continue;
      const cost = tryParseCost(card.cost);
      if (cost !== null && player.gold >= cost) {
        actions.push({ type: "play_event", playerId, cardId: card.id });
      }
    }
  }

  // equip — items to co-located units, across all positions (1 AP)
  if (ap >= 1) {
    const positions: BoardPosition[] = [
      { type: "hq", playerId },
      ...Array.from({ length: gridRows * gridCols }, (_, i) => ({
        type: "grid" as const,
        row: Math.floor(i / gridCols),
        col: i % gridCols,
      })),
    ];

    for (const pos of positions) {
      const items = getItemsAtPosition(state.players, state.grid, pos)
        .filter((i) => i.ownerId === playerId);
      const units = getUnitsAtPosition(state.players, state.grid, pos)
        .filter((u) => u.ownerId === playerId);
      for (const item of items) {
        for (const unit of units) {
          actions.push({ type: "equip", playerId, itemId: item.id, unitId: unit.id });
        }
      }
    }
  }

  // raze — units on grid at locations with no enemies (raze_ap_cost AP)
  const razeCost = getConfigNumber(state, "raze_ap_cost", 3);
  if (ap >= razeCost) {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = state.grid[r][c];
        if (!cell.location) continue;
        const hasEnemy = cell.units.some((u) => u.ownerId !== playerId);
        if (hasEnemy) continue;
        for (const unit of cell.units) {
          if (unit.ownerId === playerId) {
            actions.push({ type: "raze", playerId, unitId: unit.id, row: r, col: c });
          }
        }
      }
    }
  }

  // attack — cells where player has units and enemies exist (1 AP)
  if (ap >= 1) {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = state.grid[r][c];
        const myUnits = cell.units.filter((u) => u.ownerId === playerId);
        const enemyUnits = cell.units.filter((u) => u.ownerId !== playerId);
        if (myUnits.length > 0 && enemyUnits.length > 0) {
          // Offer attacking with all owned units at that cell
          actions.push({
            type: "attack",
            playerId,
            unitIds: myUnits.map((u) => u.id) as [string, ...string[]],
            row: r,
            col: c,
          });
        }
      }
    }
  }

  // attempt_mission — locations with missions where player meets requirements (1 AP)
  if (ap >= 1) {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = state.grid[r][c];
        if (!cell.location?.requirements || !cell.location?.rewards) continue;
        const friendlyUnits = cell.units.filter((u) => u.ownerId === playerId);
        if (friendlyUnits.length === 0) continue;
        let requirements: ReturnType<typeof parseRequirements>;
        try {
          requirements = parseRequirements(cell.location.requirements);
        } catch (err) {
          // Unparseable requirement string (see #60) — skip this mission
          console.warn(
            `Skipping mission at (${r},${c}): failed to parse requirements ` +
              `"${cell.location.requirements}" — ${err instanceof Error ? err.message : err}`,
          );
          continue;
        }
        if (checkMissionRequirements(requirements, friendlyUnits, state, queries, { row: r, col: c })) {
          actions.push({ type: "attempt_mission", playerId, row: r, col: c });
        }
      }
    }
  }

  // activate — deferred to #20

  return actions;
}
