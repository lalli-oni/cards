import type { MainGameState } from "../types";
import type { EffectListener, QueryListener } from "./types";
import {
  LOCATION_EFFECTS,
  POLICY_EFFECTS,
  PASSIVE_EVENT_EFFECTS,
  TRAP_EFFECTS,
  ITEM_EFFECTS,
} from "./effects";

export interface RebuildResult {
  listeners: EffectListener[];
  queries: QueryListener[];
}

/**
 * Derive the active listener and query lists from current game state.
 *
 * Scans locations, policies, passive events, traps, and items for cards
 * whose definitionId has a matching effect factory. Cards without effects
 * are silently skipped.
 *
 * Called once per action — the returned arrays are used for the duration
 * of that action's processing.
 */
export function rebuildListeners(state: MainGameState): RebuildResult {
  const listeners: EffectListener[] = [];
  const queries: QueryListener[] = [];

  // Grid: locations and items
  for (let r = 0; r < state.grid.length; r++) {
    for (let c = 0; c < state.grid[r].length; c++) {
      const cell = state.grid[r][c];

      // Location effects
      if (cell.location) {
        const factory = LOCATION_EFFECTS[cell.location.definitionId];
        if (factory) {
          const result = factory(cell.location, cell.location.ownerId, r, c);
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
      }

      // Stored / equipped item effects (items sitting at a grid location)
      for (const item of cell.items) {
        const factory = ITEM_EFFECTS[item.definitionId];
        if (factory) {
          const result = factory(item, item.ownerId, { row: r, col: c });
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
      }
    }
  }

  // Per-player: policies, passive events, traps, HQ items
  for (const player of state.players) {
    for (const policy of player.activePolicies) {
      const factory = POLICY_EFFECTS[policy.definitionId];
      if (factory) {
        const result = factory(policy, player.id);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    for (const pe of player.passiveEvents) {
      const factory = PASSIVE_EVENT_EFFECTS[pe.definitionId];
      if (factory) {
        const result = factory(pe, player.id);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    for (const trap of player.activeTraps) {
      const factory = TRAP_EFFECTS[trap.card.definitionId];
      if (factory) {
        const result = factory(trap, player.id);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    // HQ items (stored items not on grid)
    for (const card of player.hq) {
      if (card.type === "item") {
        const factory = ITEM_EFFECTS[card.definitionId];
        if (factory) {
          const result = factory(card, player.id);
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
      }
    }
  }

  return { listeners, queries };
}
