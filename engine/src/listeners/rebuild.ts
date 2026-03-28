import type { MainGameState } from "../types";
import type { EffectListener } from "./types";
import {
  LOCATION_EFFECTS,
  POLICY_EFFECTS,
  PASSIVE_EVENT_EFFECTS,
  TRAP_EFFECTS,
  ITEM_EFFECTS,
} from "./effects";

/**
 * Derive the active listener list from current game state.
 *
 * Scans locations, policies, passive events, traps, and items for cards
 * whose definitionId has a matching effect factory. Cards without effects
 * are silently skipped.
 *
 * Called once per action — the returned array is used for the duration
 * of that action's processing.
 */
export function rebuildListeners(state: MainGameState): EffectListener[] {
  const listeners: EffectListener[] = [];

  // Grid: locations and items
  for (let r = 0; r < state.grid.length; r++) {
    for (let c = 0; c < state.grid[r].length; c++) {
      const cell = state.grid[r][c];

      // Location effects
      if (cell.location) {
        const factory = LOCATION_EFFECTS[cell.location.definitionId];
        if (factory) {
          listeners.push(...factory(cell.location, cell.location.ownerId, r, c));
        }
      }

      // Stored / equipped item effects (items sitting at a grid location)
      for (const item of cell.items) {
        const factory = ITEM_EFFECTS[item.definitionId];
        if (factory) {
          listeners.push(...factory(item, item.ownerId, { row: r, col: c }));
        }
      }
    }
  }

  // Per-player: policies, passive events, traps, HQ items
  for (const player of state.players) {
    for (const policy of player.activePolicies) {
      const factory = POLICY_EFFECTS[policy.definitionId];
      if (factory) {
        listeners.push(...factory(policy, player.id));
      }
    }

    for (const pe of player.passiveEvents) {
      const factory = PASSIVE_EVENT_EFFECTS[pe.definitionId];
      if (factory) {
        listeners.push(...factory(pe, player.id));
      }
    }

    for (const trap of player.activeTraps) {
      const factory = TRAP_EFFECTS[trap.card.definitionId];
      if (factory) {
        listeners.push(...factory(trap, player.id));
      }
    }

    // HQ items (stored items not on grid)
    for (const card of player.hq) {
      if (card.type === "item") {
        const factory = ITEM_EFFECTS[card.definitionId];
        if (factory) {
          listeners.push(...factory(card, player.id));
        }
      }
    }
  }

  return listeners;
}
