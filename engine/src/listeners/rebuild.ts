import type { MainGameState, UnitCard } from "../types";
import { itemController } from "../item-helpers";
import type { EffectListener, QueryListener } from "./types";
import {
  LOCATION_EFFECTS,
  POLICY_EFFECTS,
  PASSIVE_EVENT_EFFECTS,
  TRAP_EFFECTS,
  ITEM_EFFECTS,
  UNIT_EFFECTS,
} from "./effects";
import { keywordEffects } from "../keyword-effects";

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
          const result = factory(cell.location, cell.location.controllerId, r, c);
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
        const kwResult = keywordEffects(cell.location, cell.location.controllerId, { row: r, col: c });
        listeners.push(...kwResult.listeners);
        queries.push(...kwResult.queries);
      }

      // Stored / equipped item effects (items sitting at a grid location).
      // An item's side comes from its bearer, so a loose one contributes its
      // effects with no controller at all.
      for (const item of cell.items) {
        const controllerId = itemController(item, { type: "grid", row: r, col: c }, cell.units);
        const factory = ITEM_EFFECTS[item.definitionId];
        if (factory) {
          const result = factory(item, controllerId, { row: r, col: c });
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
        const kwResult = keywordEffects(item, controllerId, { row: r, col: c });
        listeners.push(...kwResult.listeners);
        queries.push(...kwResult.queries);
      }

      // Unit effects (units on the grid)
      for (const unit of cell.units) {
        const factory = UNIT_EFFECTS[unit.definitionId];
        if (factory) {
          const result = factory(unit, unit.controllerId, { row: r, col: c });
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
        const kwResult = keywordEffects(unit, unit.controllerId, { row: r, col: c });
        listeners.push(...kwResult.listeners);
        queries.push(...kwResult.queries);
      }
    }
  }

  // Per-player: policies, passive events, traps, HQ items.
  // The per-player arrays hold cards whose controllerId equals player.id by
  // construction, so reading controllerId is just symmetry with the grid loop
  // above — it also future-proofs against any HQ-borrowing mechanic.
  for (const player of state.players) {
    for (const policy of player.activePolicies) {
      const factory = POLICY_EFFECTS[policy.definitionId];
      if (factory) {
        const result = factory(policy, policy.controllerId);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    for (const pe of player.passiveEvents) {
      const factory = PASSIVE_EVENT_EFFECTS[pe.definitionId];
      if (factory) {
        const result = factory(pe, pe.controllerId);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    for (const trap of player.activeTraps) {
      const factory = TRAP_EFFECTS[trap.card.definitionId];
      if (factory) {
        const result = factory(trap, trap.card.controllerId);
        listeners.push(...result.listeners);
        queries.push(...result.queries);
      }
    }

    // HQ items + units (cards in play but not yet on the grid). hqUnits is
    // hoisted for itemController, which resolves an equipped item's bearer
    // among them.
    const hqUnits = player.hq.filter((c): c is UnitCard => c.type === "unit");
    for (const card of player.hq) {
      if (card.type === "item") {
        const controllerId = itemController(card, { type: "hq", playerId: player.id }, hqUnits);
        const factory = ITEM_EFFECTS[card.definitionId];
        if (factory) {
          const result = factory(card, controllerId);
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
        const kwResult = keywordEffects(card, controllerId);
        listeners.push(...kwResult.listeners);
        queries.push(...kwResult.queries);
      } else if (card.type === "unit") {
        const factory = UNIT_EFFECTS[card.definitionId];
        if (factory) {
          const result = factory(card, card.controllerId);
          listeners.push(...result.listeners);
          queries.push(...result.queries);
        }
        const kwResult = keywordEffects(card, card.controllerId);
        listeners.push(...kwResult.listeners);
        queries.push(...kwResult.queries);
      }
    }
  }

  return { listeners, queries };
}
