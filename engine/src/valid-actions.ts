import { parse, DSLParseError } from "./effect-dsl";
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
      // HQ: all items/units belong to the player by definition.
      // Grid: filter by ownerId since multiple players share cells.
      const ownerFilter = pos.type === "hq";
      const items = getItemsAtPosition(state.players, state.grid, pos)
        .filter((i) => ownerFilter || i.ownerId === playerId);
      const units = getUnitsAtPosition(state.players, state.grid, pos)
        .filter((u) => ownerFilter || u.ownerId === playerId);
      for (const item of items) {
        for (const unit of units) {
          // Skip if already equipped on this unit
          if (item.equippedTo === unit.id) continue;
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

  // activate — unit actions from grid units
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      for (const unit of state.grid[r][c].units) {
        if (unit.ownerId !== playerId) continue;
        if (!unit.actions) continue;
        for (const actionDef of unit.actions) {
          if (ap < actionDef.apCost) continue;
          const targets = inferActivateTargets(state, unit.id, actionDef.effect, r, c, playerId);
          for (const t of targets) {
            actions.push({
              type: "activate",
              playerId,
              cardId: unit.id,
              actionName: actionDef.name,
              ...t,
            });
          }
        }
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Activate target inference
// ---------------------------------------------------------------------------

type ActivateTarget = {
  targetId?: string;
  targetCell?: { row: number; col: number };
};

/**
 * Infer valid targets for an activate action by doing a shallow parse of
 * the DSL effect string. Returns one entry per valid target combination.
 */
function inferActivateTargets(
  state: MainGameState,
  _unitId: string,
  effectStr: string,
  unitRow: number,
  unitCol: number,
  playerId: string,
): ActivateTarget[] {
  let ast;
  try {
    ast = parse(effectStr);
  } catch (err) {
    if (err instanceof DSLParseError) {
      console.warn(`Unparseable effect "${effectStr}": ${err.message}`);
      return [{}];
    }
    throw err;
  }

  // Scan the first verb in each compound member to determine targeting needs
  const targetSets: ActivateTarget[][] = [];

  for (const effect of ast) {
    if (effect.length === 0) continue;
    const first = effect[0].primitive;
    const tokenNames = first.target?.tokens.map((t) => t.name) ?? [];

    if (tokenNames.includes("self") || tokenNames.length === 0) {
      // Self or no target — check if the verb is "move"
      if (first.verb === "move" && tokenNames.includes("self")) {
        // One action per valid adjacent cell
        const moves = getAdjacentMoveTargets(state, unitRow, unitCol);
        targetSets.push(moves.map((m) => ({ targetCell: { row: m.row, col: m.col } })));
      } else {
        targetSets.push([{}]);
      }
    } else if (tokenNames.includes("enemy")) {
      const adjacent = tokenNames.includes("adjacent");
      const enemies = getUnitsInRange(state, unitRow, unitCol, playerId, "enemy", adjacent);
      if (enemies.length === 0) return []; // No valid targets
      targetSets.push(enemies.map((u) => ({ targetId: u.id })));
    } else if (tokenNames.includes("friendly")) {
      if (tokenNames.includes("all")) {
        targetSets.push([{}]); // All friendly — no individual targeting
      } else {
        const friends = getUnitsInRange(state, unitRow, unitCol, playerId, "friendly", false);
        if (friends.length === 0) return [];
        targetSets.push(friends.map((u) => ({ targetId: u.id })));
      }
    } else if (tokenNames.includes("opponent") || tokenNames.includes("deck") ||
               tokenNames.includes("location") || tokenNames.includes("market")) {
      targetSets.push([{}]); // No unit targeting needed
    } else {
      targetSets.push([{}]);
    }
  }

  if (targetSets.length === 0) return [{}];

  // For compound effects, the first compound member that needs targeting
  // determines the action targets. Later members use the same context.
  // Find the first set with actual targeting (not just [{}])
  for (const set of targetSets) {
    if (set.length > 0 && set.some((t) => t.targetId || t.targetCell)) {
      return set;
    }
  }
  return [{}];
}

function getAdjacentMoveTargets(
  state: MainGameState,
  row: number,
  col: number,
): { row: number; col: number }[] {
  const results: { row: number; col: number }[] = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (const [dr, dc] of dirs) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= state.grid.length || c < 0 || c >= state.grid[0].length) continue;
    if (!state.grid[r][c].location) continue;
    if (areFacingEdgesOpen(state.grid, row, col, r, c)) {
      results.push({ row: r, col: c });
    }
  }
  return results;
}

function getUnitsInRange(
  state: MainGameState,
  row: number,
  col: number,
  playerId: string,
  filter: "enemy" | "friendly",
  adjacent: boolean,
): { id: string }[] {
  const units: { id: string }[] = [];
  if (adjacent) {
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
    for (const [dr, dc] of dirs) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= state.grid.length || c < 0 || c >= state.grid[0].length) continue;
      for (const u of state.grid[r][c].units) {
        if (filter === "enemy" && u.ownerId !== playerId) units.push({ id: u.id });
        if (filter === "friendly" && u.ownerId === playerId) units.push({ id: u.id });
      }
    }
  } else {
    for (const u of state.grid[row][col].units) {
      if (filter === "enemy" && u.ownerId !== playerId) units.push({ id: u.id });
      if (filter === "friendly" && u.ownerId === playerId) units.push({ id: u.id });
    }
  }
  return units;
}
