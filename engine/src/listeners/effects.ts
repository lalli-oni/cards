import type { Draft } from "immer";
import type { EffectDefinition, EffectListener, EmitFn } from "./types";
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
import { isOrthogonallyAdjacent } from "../grid-helpers";
import { drawOneCard } from "../deck-helpers";
import { countActionsThisTurn } from "./query";

// ---------------------------------------------------------------------------
// Effect definition types — each card type has a factory that produces
// an EffectDefinition (event listeners + query listeners).
// ---------------------------------------------------------------------------

export type LocationEffectFactory = (
  loc: LocationCard,
  ownerId: string,
  row: number,
  col: number,
) => EffectDefinition;

export type PolicyEffectFactory = (
  policy: PolicyCard,
  ownerId: string,
) => EffectDefinition;

export type PassiveEventEffectFactory = (
  pe: ActivePassiveEvent,
  ownerId: string,
) => EffectDefinition;

export type TrapEffectFactory = (
  trap: Trap,
  ownerId: string,
) => EffectDefinition;

export type ItemEffectFactory = (
  item: ItemCard,
  ownerId: string,
  position?: { row: number; col: number },
) => EffectDefinition;

// ---------------------------------------------------------------------------
// Static registries keyed by definitionId.
// ---------------------------------------------------------------------------

export const LOCATION_EFFECTS: Record<string, LocationEffectFactory> = {
  "the-silk-road": (loc, ownerId, row, col) => ({
    listeners: [{
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
    queries: [],
  }),

  "trade-port": (loc, ownerId, row, col) => ({
    listeners: [{
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
    queries: [],
  }),

  "the-forge": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-forge", ownerId: _ownerId, position: { row, col } },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.position?.row === row && ctx.position?.col === col ? 1 : 0,
    }],
  }),

  "the-great-library": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-great-library", ownerId: _ownerId, position: { row, col } },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && ctx.position?.row === row && ctx.position?.col === col
        && ctx.unit.attributes.includes("Scientist") ? 1 : 0,
    }],
  }),

  "versailles": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "versailles", ownerId: _ownerId, position: { row, col } },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && ctx.position?.row === row && ctx.position?.col === col
        && ctx.unit.attributes.includes("Politician") ? 1 : 0,
    }],
  }),

  "the-arena": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-arena", ownerId: _ownerId, position: { row, col } },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.combat?.role === "attacker"
        && ctx.combat.row === row && ctx.combat.col === col ? 1 : 0,
    }],
  }),

  "the-great-wall": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-great-wall", ownerId: _ownerId, position: { row, col } },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.combat?.role === "defender"
        && ctx.combat.row === row && ctx.combat.col === col ? 1 : 0,
    }],
  }),

  "the-bazaar": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-bazaar", ownerId: _ownerId, position: { row, col } },
      query: "cost" as const,
      min: 1,
      modify: (state, ctx) => {
        if (ctx.action !== "buy") return 0;
        const cell = state.grid[row]?.[col];
        return cell?.units.some((u) => u.ownerId === ctx.playerId) ? -1 : 0;
      },
    }],
  }),

  "machu-picchu": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "machu-picchu", ownerId: _ownerId, position: { row, col } },
      query: "protection" as const,
      isProtected: (_state, ctx) =>
        ctx.kind === "event_target" && ctx.position.row === row && ctx.position.col === col,
    }],
  }),

  "the-catacombs": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-catacombs", ownerId: _ownerId, position: { row, col } },
      query: "protection" as const,
      isProtected: (_state, ctx) =>
        ctx.kind === "event_injury" && ctx.position.row === row && ctx.position.col === col,
    }],
  }),

  "sherwood-forest": (_loc, _ownerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "sherwood-forest", ownerId: _ownerId, position: { row, col } },
      query: "protection" as const,
      isProtected: (_state, ctx) =>
        ctx.kind === "contest_target" && ctx.contestStat === "strength"
        && ctx.position.row === row && ctx.position.col === col
        && ctx.unit.cunning >= 7,
    }],
  }),
};

export const POLICY_EFFECTS: Record<string, PolicyEffectFactory> = {
  "warlord": (policy, ownerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "warlord", ownerId },
      on: "combat_resolved",
      condition: (_state, event) => "winnerId" in event && event.winnerId === ownerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, ownerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "warlord" });
      },
    }],
    queries: [],
  }),

  "healer": (policy, ownerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "healer", ownerId },
      on: "unit_healed",
      condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, ownerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "healer" });
      },
    }],
    queries: [],
  }),

  "militarist": (policy, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "militarist", ownerId },
      query: "cost" as const,
      min: 1,
      modify: (_state, ctx) => {
        if (ctx.playerId !== ownerId) return 0;
        const card = ctx.card;
        if (card.type === "unit" && "attributes" in card && (card as UnitCard).attributes.includes("Warrior")) return -1;
        if (card.type === "item" && card.keywords?.includes("Weapon")) return -1;
        return 0;
      },
    }],
  }),

  "diplomat": (policy, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "diplomat", ownerId },
      query: "cost" as const,
      min: 1,
      modify: (state, ctx) => {
        if (ctx.playerId !== ownerId || ctx.action !== "buy") return 0;
        const card = ctx.card;
        const isPolitician = card.type === "unit" && "attributes" in card && (card as UnitCard).attributes.includes("Politician");
        const isAccessory = card.type === "item" && card.keywords?.includes("Accessory");
        if (!isPolitician && !isAccessory) return 0;
        return countActionsThisTurn(state, ownerId, (a) => a.type === "buy") === 0 ? -1 : 0;
      },
    }],
  }),

  "industrialist": (policy, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "industrialist", ownerId },
      query: "cost" as const,
      min: 1,
      modify: (state, ctx) => {
        if (ctx.playerId !== ownerId || ctx.action !== "buy") return 0;
        return countActionsThisTurn(state, ownerId, (a) => a.type === "buy") === 0 ? -1 : 0;
      },
    }],
  }),

  "pioneer": (policy, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "pioneer", ownerId },
      query: "ap" as const,
      modify: (state, ctx) => {
        if (ctx.playerId !== ownerId || ctx.action.type !== "move") return 0;
        return countActionsThisTurn(state, ownerId, (a) => a.type === "move") === 0 ? -99 : 0;
      },
    }],
  }),

  "scholar": (policy, ownerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "scholar", ownerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
      apply: (draft, _event, emitFn) => {
        const player = getPlayerById(draft, ownerId);
        const helperEvents: GameEvent[] = [];
        drawOneCard(draft, player, helperEvents);
        for (const e of helperEvents) emitFn(e);
      },
    }],
    queries: [],
  }),
};

export const PASSIVE_EVENT_EFFECTS: Record<string, PassiveEventEffectFactory> = {
  "plague": (pe, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "plague", ownerId },
      query: "stat" as const,
      modify: (state, ctx) => {
        if (ctx.stat !== "strength" || !ctx.position || !pe.targetId) return 0;
        // Find the target location's position
        for (let r = 0; r < state.grid.length; r++) {
          for (let c = 0; c < state.grid[r].length; c++) {
            if (state.grid[r][c].location?.id === pe.targetId) {
              if (
                (ctx.position.row === r && ctx.position.col === c) ||
                isOrthogonallyAdjacent(ctx.position.row, ctx.position.col, r, c)
              ) {
                return -2;
              }
              return 0;
            }
          }
        }
        return 0;
      },
    }],
  }),

  "arms-race": (pe, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "arms-race", ownerId },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.unit.ownerId === ownerId
        && ctx.unit.attributes.includes("Warrior") ? 2 : 0,
    }],
  }),

  "renaissance": (pe, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "renaissance", ownerId },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && ctx.unit.ownerId === ownerId
        && ctx.unit.attributes.includes("Scientist") ? 2 : 0,
    }],
  }),

  "diplomatic-summit": (pe, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "diplomatic-summit", ownerId },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && ctx.unit.ownerId === ownerId
        && ctx.unit.attributes.includes("Diplomat") ? 2 : 0,
    }],
  }),

  "trade-embargo": (pe, ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "trade-embargo", ownerId },
      query: "cost" as const,
      modify: (_state, ctx) =>
        ctx.action === "buy" && ctx.playerId !== ownerId ? 2 : 0,
    }],
  }),

  "golden-age": (pe, ownerId) => ({
    listeners: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "golden-age", ownerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, ownerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "golden-age" });
      },
    }],
    queries: [],
  }),
};

export const ITEM_EFFECTS: Record<string, ItemEffectFactory> = {
  "ancient-scroll": (item, _ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "ancient-scroll", ownerId: _ownerId },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && item.equippedTo === ctx.unit.id ? 2 : 0,
    }],
  }),

  "war-banner": (item, ownerId, position) => ({
    listeners: [],
    queries: [
      // Equipped: +1 str to friendly units at same location
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "war-banner", ownerId, position },
        query: "stat" as const,
        modify: (_state, ctx) => {
          if (!item.equippedTo || ctx.stat !== "strength" || !position) return 0;
          if (ctx.position?.row !== position.row || ctx.position?.col !== position.col) return 0;
          return ctx.unit.ownerId === ownerId ? 1 : 0;
        },
      },
      // Stored: +2 str to attackers in contests here
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "war-banner", ownerId, position },
        query: "stat" as const,
        modify: (_state, ctx) => {
          if (item.equippedTo || ctx.stat !== "strength" || !position) return 0;
          return ctx.combat?.role === "attacker"
            && ctx.combat.row === position.row && ctx.combat.col === position.col ? 2 : 0;
        },
      },
    ],
  }),

  "holy-relic": (item, ownerId, position) => ({
    listeners: [],
    queries: [
      // Equipped: +3 charisma if Spiritual
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "holy-relic", ownerId, position },
        query: "stat" as const,
        modify: (_state, ctx) =>
          ctx.stat === "charisma" && item.equippedTo === ctx.unit.id
          && ctx.unit.attributes.includes("Spiritual") ? 3 : 0,
      },
      // Stored: +1 charisma to Spiritual units at location
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "holy-relic", ownerId, position },
        query: "stat" as const,
        modify: (_state, ctx) => {
          if (item.equippedTo || ctx.stat !== "charisma" || !position) return 0;
          if (ctx.position?.row !== position.row || ctx.position?.col !== position.col) return 0;
          return ctx.unit.attributes.includes("Spiritual") ? 1 : 0;
        },
      },
    ],
  }),

  "philosophers-stone": (item, _ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "philosophers-stone", ownerId: _ownerId },
      query: "stat" as const,
      modify: (_state, ctx) => item.equippedTo === ctx.unit.id ? 2 : 0,
    }],
  }),

  "crowning-jewel": (item, _ownerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "crowning-jewel", ownerId: _ownerId },
      query: "stat" as const,
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && item.equippedTo === ctx.unit.id
        && ctx.unit.attributes.includes("Politician") ? 2 : 0,
    }],
  }),

  "merchant-ledger": (item, ownerId) => ({
    listeners: [{
      source: { type: "item", cardId: item.id, definitionId: "merchant-ledger", ownerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, ownerId);
        player.gold += 2;
        emit({ type: "gold_changed", playerId: ownerId, amount: 2, reason: "merchant-ledger" });
      },
    }],
    queries: [],
  }),

  "trade-goods": (item, ownerId) => ({
    listeners: [{
      source: { type: "item", cardId: item.id, definitionId: "trade-goods", ownerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === ownerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, ownerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: ownerId, amount: 1, reason: "trade-goods" });
      },
    }],
    queries: [],
  }),
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
 * A shared `fired` flag prevents the trap from firing twice in the same action.
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
  "ambush": (trap, ownerId) => ({
    listeners: makeEntryTrapListeners(trap, ownerId, (draft, cell, unit, row, col, emit) => {
      if (unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(cell, unit, row, col, emit);
      }
    }),
    queries: [],
  }),

  "assassination-attempt": (trap, ownerId) => ({
    listeners: makeEntryTrapListeners(trap, ownerId, (draft, cell, unit, row, col, emit) => {
      if (unit.strength <= 6 || unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(cell, unit, row, col, emit);
      }
    }),
    queries: [],
  }),
};
