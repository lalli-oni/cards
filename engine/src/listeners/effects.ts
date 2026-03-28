import type { Draft } from "immer";
import type { EffectListener, EmitFn } from "./types";
import type {
  GameEvent,
  ItemCard,
  LocationCard,
  MainGameState,
  PolicyCard,
  ActivePassiveEvent,
  Trap,
  UnitCard,
} from "../types";
import { killUnit, injureUnit } from "../unit-helpers";
import { getPlayerById } from "../state-helpers";
import { drawOneCard } from "../deck-helpers";

// ---------------------------------------------------------------------------
// Effect definition types — each card type has a factory that produces
// listeners given the card instance and its context from game state.
// ---------------------------------------------------------------------------

export type LocationEffectFactory = (
  loc: LocationCard,
  ownerId: string,
  row: number,
  col: number,
) => EffectListener[];

export type PolicyEffectFactory = (
  policy: PolicyCard,
  ownerId: string,
) => EffectListener[];

export type PassiveEventEffectFactory = (
  pe: ActivePassiveEvent,
  ownerId: string,
) => EffectListener[];

export type TrapEffectFactory = (
  trap: Trap,
  ownerId: string,
) => EffectListener[];

export type ItemEffectFactory = (
  item: ItemCard,
  ownerId: string,
  position?: { row: number; col: number },
) => EffectListener[];

// ---------------------------------------------------------------------------
// Static registries keyed by definitionId.
// ---------------------------------------------------------------------------

export const LOCATION_EFFECTS: Record<string, LocationEffectFactory> = {
  "the-silk-road": (loc, ownerId, row, col) => [{
    source: { type: "location", cardId: loc.id, definitionId: "the-silk-road", ownerId, position: { row, col } },
    on: "turn_started",
    condition: (state, event) => {
      if (!("playerId" in event) || event.playerId !== ownerId) return false;
      const cell = state.grid[row]?.[col];
      return cell != null && cell.units.length > 0;
    },
    apply: (_draft, _event, emit) => {
      const player = getPlayerById(_draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "the-silk-road" });
    },
  }],

  "trade-port": (loc, ownerId, row, col) => [{
    source: { type: "location", cardId: loc.id, definitionId: "trade-port", ownerId, position: { row, col } },
    on: "turn_started",
    condition: (state, event) => {
      if (!("playerId" in event) || event.playerId !== ownerId) return false;
      const cell = state.grid[row]?.[col];
      if (!cell) return false;
      return cell.units.some((u) => u.attributes.includes("Diplomat"));
    },
    apply: (_draft, _event, emit) => {
      const player = getPlayerById(_draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "trade-port" });
    },
  }],
};
export const POLICY_EFFECTS: Record<string, PolicyEffectFactory> = {
  "warlord": (policy, ownerId) => [{
    source: { type: "policy", cardId: policy.id, definitionId: "warlord", ownerId },
    on: "combat_resolved",
    condition: (_state, event) => "winnerId" in event && event.winnerId === ownerId,
    apply: (draft, _event, emit) => {
      const player = getPlayerById(draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "warlord" });
    },
  }],

  "healer": (policy, ownerId) => [{
    source: { type: "policy", cardId: policy.id, definitionId: "healer", ownerId },
    on: "unit_healed",
    condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
    apply: (draft, _event, emit) => {
      const player = getPlayerById(draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "healer" });
    },
  }],

  "scholar": (policy, ownerId) => [{
    source: { type: "policy", cardId: policy.id, definitionId: "scholar", ownerId },
    on: "turn_started",
    condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
    apply: (draft, _event, emitFn) => {
      const player = getPlayerById(draft, ownerId);
      // drawOneCard pushes to an events array; collect and re-emit so they're logged.
      const helperEvents: GameEvent[] = [];
      drawOneCard(draft, player, helperEvents);
      for (const e of helperEvents) emitFn(e);
    },
  }],
};
export const PASSIVE_EVENT_EFFECTS: Record<string, PassiveEventEffectFactory> = {
  "golden-age": (pe, ownerId) => [{
    source: { type: "passive_event", cardId: pe.id, definitionId: "golden-age", ownerId },
    on: "turn_started",
    condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
    apply: (draft, _event, emit) => {
      const player = getPlayerById(draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "golden-age" });
    },
  }],
};
export const ITEM_EFFECTS: Record<string, ItemEffectFactory> = {
  "merchant-ledger": (item, ownerId) => [{
    source: { type: "item", cardId: item.id, definitionId: "merchant-ledger", ownerId },
    on: "turn_started",
    condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
    apply: (draft, _event, emit) => {
      const player = getPlayerById(draft, ownerId);
      player.gold += 2;
      emit({ type: "gold_changed", playerId: ownerId, amount: 2, reason: "merchant-ledger" });
    },
  }],

  "trade-goods": (item, ownerId) => [{
    source: { type: "item", cardId: item.id, definitionId: "trade-goods", ownerId },
    on: "turn_started",
    condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
    apply: (draft, _event, emit) => {
      const player = getPlayerById(draft, ownerId);
      player.gold += 1;
      emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "trade-goods" });
    },
  }],
};

// ---------------------------------------------------------------------------
// Trap effects
// ---------------------------------------------------------------------------

/** Extract destination position from unit_entered or unit_moved events. */
function getDestination(event: GameEvent): { row: number; col: number; unitId: string } | null {
  if (event.type === "unit_entered") {
    return { row: event.row, col: event.col, unitId: event.unitId };
  }
  if (event.type === "unit_moved" && event.toRow >= 0 && event.toCol >= 0) {
    return { row: event.toRow, col: event.toCol, unitId: event.unitId };
  }
  return null;
}

/** Discard a trap after it fires: remove from activeTraps, push to discard, emit trap_triggered. */
function discardTrap(
  draft: Draft<MainGameState>,
  trap: Trap,
  emit: EmitFn,
): void {
  for (const player of draft.players) {
    const idx = player.activeTraps.findIndex((t) => t.card.id === trap.card.id);
    if (idx !== -1) {
      player.activeTraps.splice(idx, 1);
      player.discardPile.push(trap.card);
      emit({
        type: "trap_triggered",
        playerId: player.id,
        cardId: trap.card.id,
        targetId: trap.targetId,
      });
      break;
    }
  }
}

/**
 * Build listeners for a trap that fires when an enemy unit enters a location.
 * Returns two listeners: one for unit_entered, one for unit_moved (to destination).
 * A shared `fired` flag prevents the trap from firing twice in the same action
 * (e.g. if both unit_entered and unit_moved are emitted for the same unit).
 */
function makeEntryTrapListeners(
  trap: Trap,
  ownerId: string,
  resolve: (
    draft: Draft<MainGameState>,
    cell: Draft<{ units: UnitCard[]; items: ItemCard[] }>,
    unit: Draft<UnitCard>,
    row: number,
    col: number,
    emit: EmitFn,
  ) => void,
): EffectListener[] {
  let fired = false;

  const source = {
    type: "trap" as const,
    cardId: trap.card.id,
    definitionId: trap.card.definitionId,
    ownerId,
  };

  const condition = (state: MainGameState, event: GameEvent): boolean => {
    if (fired) return false;
    if (!("playerId" in event) || event.playerId === ownerId) return false;
    const dest = getDestination(event);
    if (!dest) return false;
    if (trap.targetId) {
      const loc = state.grid[dest.row]?.[dest.col]?.location;
      if (!loc || loc.id !== trap.targetId) return false;
    }
    return true;
  };

  const apply = (draft: Draft<MainGameState>, event: GameEvent, emit: EmitFn): void => {
    if (fired) return;
    fired = true;
    const dest = getDestination(event);
    if (!dest) return;
    const cell = draft.grid[dest.row][dest.col];
    const unit = cell.units.find((u: Draft<UnitCard>) => u.id === dest.unitId);
    if (!unit) return;

    resolve(draft, cell, unit, dest.row, dest.col, emit);
    discardTrap(draft, trap, emit);
  };

  return [
    { source, on: "unit_entered", condition, apply },
    { source, on: "unit_moved", condition, apply },
  ];
}

export const TRAP_EFFECTS: Record<string, TrapEffectFactory> = {
  "ambush": (trap, ownerId) =>
    makeEntryTrapListeners(trap, ownerId, (draft, cell, unit, row, col, emit) => {
      if (unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(cell, unit, row, col, emit);
      }
    }),

  "assassination-attempt": (trap, ownerId) =>
    makeEntryTrapListeners(trap, ownerId, (draft, cell, unit, row, col, emit) => {
      if (unit.strength <= 6 || unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(cell, unit, row, col, emit);
      }
    }),
};
