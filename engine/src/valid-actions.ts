import type { GameState, Action, SeedingAction, MainAction } from "./types";

/**
 * Return all legal actions for a player given the current state.
 * Used by clients (to show available moves) and bots (to choose a move).
 */
export function getValidActions(state: GameState, playerId: string): Action[] {
  if (state.turn.activePlayerId !== playerId) {
    return [];
  }

  if (state.phase === "ended") {
    return [];
  }

  if (state.phase === "seeding") {
    return getSeedingValidActions(state, playerId);
  }

  return getMainValidActions(state, playerId);
}

// ---------------------------------------------------------------------------
// Seeding phase
// ---------------------------------------------------------------------------

function getSeedingValidActions(state: GameState, playerId: string): SeedingAction[] {
  const seeding = state.seedingState!;

  switch (seeding.step) {
    case "seed_draw":
      return [{ type: "seed_draw", playerId }];

    case "seed_keep": {
      // Player must choose keepCount cards to keep and exposeCount to expose
      // We return a single template — the adapter fills in the IDs
      return [{ type: "seed_keep", playerId, keepIds: [], exposeIds: [] }];
    }

    case "seed_steal": {
      // One action per card in the middle area
      const actions: SeedingAction[] = [];
      for (const card of seeding.middleArea) {
        if (card.type === "location") {
          // For locations, offer each empty grid cell
          for (let r = 0; r < state.grid.length; r++) {
            for (let c = 0; c < state.grid[r].length; c++) {
              if (state.grid[r][c].location === null) {
                actions.push({ type: "seed_steal", playerId, cardId: card.id, row: r, col: c });
              }
            }
          }
        } else {
          actions.push({ type: "seed_steal", playerId, cardId: card.id });
        }
      }
      return actions;
    }

    case "prospect_split":
      return [{ type: "seed_split_prospect", playerId, topHalf: [], bottomHalf: [] }];

    case "grid_populate": {
      // One action per empty grid cell
      const actions: SeedingAction[] = [];
      for (let r = 0; r < state.grid.length; r++) {
        for (let c = 0; c < state.grid[r].length; c++) {
          if (state.grid[r][c].location === null) {
            actions.push({ type: "seed_place_location", playerId, cardId: "", row: r, col: c });
          }
        }
      }
      return actions;
    }

    case "policy_pass": {
      // Pass to the player on your left (next in turn order)
      const idx = state.turnOrder.indexOf(playerId);
      const toIdx = (idx + 1) % state.turnOrder.length;
      const toPlayerId = state.turnOrder[toIdx];
      return [{ type: "policy_pass", playerId, policyIds: [], toPlayerId }];
    }

    case "policy_pick": {
      const passed = seeding.passedPolicies[playerId] ?? [];
      return passed.map((p) => ({
        type: "policy_pick" as const,
        playerId,
        policyId: p.id,
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Main phase
// ---------------------------------------------------------------------------

function getMainValidActions(state: GameState, playerId: string): MainAction[] {
  const actions: MainAction[] = [];

  actions.push({ type: "pass", playerId });

  // TODO: compute valid actions based on AP, board state, hand, etc.

  return actions;
}
