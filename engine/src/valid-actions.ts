import { tryParseCost } from "./cost-helpers";
import {
  areFacingEdgesOpen,
  getAdjacentCells,
  getBoundaryEdges,
  isPerimeterCell,
} from "./grid-helpers";
import { getConfigNumber } from "./state-helpers";
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
      for (const card of seeding.middleArea) {
        if (card.type === "location") {
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

    case "seed_split_prospect":
      return [
        { type: "seed_split_prospect", playerId, topHalf: [], bottomHalf: [] },
      ];

    case "seed_place_location": {
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
  const player = state.players.find((p) => p.id === playerId)!;
  const ap = state.turn.actionPointsRemaining;
  const gridRows = state.grid.length;
  const gridCols = state.grid[0].length;

  // pass — always available
  actions.push({ type: "pass", playerId });

  // deploy — units/items in hand that player can afford (1 AP)
  if (ap >= 1) {
    for (const card of player.hand) {
      if (card.type === "unit" || card.type === "item") {
        const cost = tryParseCost(card.cost);
        if (cost !== null && player.gold >= cost) {
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
      const cost = tryParseCost(card.cost, ci);
      if (cost !== null && player.gold >= cost) {
        actions.push({
          type: "buy",
          playerId,
          cardId: card.id,
          costIndex: costs.length > 1 ? ci : undefined,
        });
      }
    }
  }

  // draw — if AP available (valid even with empty deck)
  if (ap >= 1) {
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
        const moveCost = unit.injured
          ? 1 + getConfigNumber(state, "injury_move_penalty", 1)
          : 1;
        if (ap < moveCost) continue;

        // Move to adjacent cells
        for (const adj of getAdjacentCells(gridRows, gridCols, r, c)) {
          if (
            state.grid[adj.row][adj.col].location &&
            areFacingEdgesOpen(state.grid, r, c, adj.row, adj.col)
          ) {
            actions.push({
              type: "move",
              playerId,
              unitId: unit.id,
              row: adj.row,
              col: adj.col,
            });
          }
        }

        // Retreat to HQ from perimeter
        if (isPerimeterCell(gridRows, gridCols, r, c)) {
          const boundaryEdges = getBoundaryEdges(r, c, gridRows, gridCols);
          const loc = state.grid[r][c].location;
          if (loc && boundaryEdges.some((edge) => loc.edges[edge])) {
            actions.push({ type: "move", playerId, unitId: unit.id, row: -1, col: -1 });
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

  // equip — items in HQ or on grid, to co-located units (1 AP)
  if (ap >= 1) {
    // HQ items → HQ units
    const hqItems = player.hq.filter((c) => c.type === "item");
    const hqUnits = player.hq.filter((c) => c.type === "unit");
    for (const item of hqItems) {
      for (const unit of hqUnits) {
        actions.push({ type: "equip", playerId, itemId: item.id, unitId: unit.id });
      }
    }

    // Grid items → co-located units
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = state.grid[r][c];
        for (const item of cell.items) {
          if (item.ownerId !== playerId) continue;
          for (const unit of cell.units) {
            if (unit.ownerId !== playerId) continue;
            actions.push({ type: "equip", playerId, itemId: item.id, unitId: unit.id });
          }
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

  // attempt_mission — locations with missions where player has units (1 AP)
  if (ap >= 1) {
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cell = state.grid[r][c];
        if (!cell.location?.mission) continue;
        if (cell.units.some((u) => u.ownerId === playerId)) {
          actions.push({ type: "attempt_mission", playerId, row: r, col: c });
        }
      }
    }
  }

  // activate — deferred to #20

  return actions;
}
