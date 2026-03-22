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

    case "seed_keep":
      return [{ type: "seed_keep", playerId, keepIds: [], exposeIds: [] }];

    case "seed_steal": {
      const actions: SeedingAction[] = [];
      for (const card of seeding.middleArea) {
        if (card.type === "location") {
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

    case "seed_split_prospect":
      return [{ type: "seed_split_prospect", playerId, topHalf: [], bottomHalf: [] }];

    case "seed_place_location": {
      const actions: SeedingAction[] = [];
      for (let r = 0; r < state.grid.length; r++) {
        for (let c = 0; c < state.grid[r].length; c++) {
          if (state.grid[r][c].location === null) {
            actions.push({ type: "seed_place_location", playerId, row: r, col: c });
          }
        }
      }
      return actions;
    }

    case "policy_pass":
      return [{ type: "policy_pass", playerId, policyIds: [] }];

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

function getMainValidActions(_state: GameState, playerId: string): MainAction[] {
  const actions: MainAction[] = [];

  actions.push({ type: "pass", playerId });

  // TODO: compute valid actions based on AP, board state, hand, etc.

  return actions;
}
