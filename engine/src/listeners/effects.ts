import type { Draft } from "immer";
import type {
  APModifierListener,
  CostModifierListener,
  EffectDefinition,
  EffectListener,
  EmitFn,
  ProtectionListener,
  StatModifierListener,
} from "./types";
import type {
  ActionDef,
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
import { hasAttribute } from "../attributes";

// ---------------------------------------------------------------------------
// Effect definition types — each card type has a factory that produces
// an EffectDefinition (event listeners + query listeners).
// ---------------------------------------------------------------------------

export type LocationEffectFactory = (
  loc: LocationCard,
  controllerId: string,
  row: number,
  col: number,
) => EffectDefinition;

export type PolicyEffectFactory = (
  policy: PolicyCard,
  controllerId: string,
) => EffectDefinition;

export type PassiveEventEffectFactory = (
  pe: ActivePassiveEvent,
  controllerId: string,
) => EffectDefinition;

export type TrapEffectFactory = (
  trap: Trap,
  controllerId: string,
) => EffectDefinition;

export type ItemEffectFactory = (
  item: ItemCard,
  controllerId: string,
  position?: { row: number; col: number },
) => EffectDefinition;

export type UnitEffectFactory = (
  unit: UnitCard,
  controllerId: string,
  position?: { row: number; col: number },
) => EffectDefinition;

// ---------------------------------------------------------------------------
// Static registries keyed by definitionId.
// ---------------------------------------------------------------------------

export const LOCATION_EFFECTS: Record<string, LocationEffectFactory> = {
  "the-silk-road": (loc, controllerId, row, col) => ({
    listeners: [{
      source: { type: "location", cardId: loc.id, definitionId: "the-silk-road", controllerId, position: { row, col } },
      on: "turn_started",
      condition: (state, event) => {
        if (!("playerId" in event)) return false;
        const cell = state.grid[row]?.[col];
        return cell != null && cell.units.some((u) => u.controllerId === event.playerId);
      },
      apply: (_draft, _event, emit) => {
        const pid = ("playerId" in _event) ? _event.playerId as string : controllerId;
        const player = getPlayerById(_draft, pid);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: pid, amount: 1, reason: "the-silk-road" });
      },
    }],
    queries: [],
  }),

  "trade-port": (loc, controllerId, row, col) => ({
    listeners: [{
      source: { type: "location", cardId: loc.id, definitionId: "trade-port", controllerId, position: { row, col } },
      on: "turn_started",
      condition: (state, event) => {
        if (!("playerId" in event)) return false;
        const cell = state.grid[row]?.[col];
        if (!cell) return false;
        return cell.units.some((u) => u.controllerId === event.playerId && hasAttribute(u, "Diplomacy"));
      },
      apply: (_draft, _event, emit) => {
        const pid = ("playerId" in _event) ? _event.playerId as string : controllerId;
        const player = getPlayerById(_draft, pid);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: pid, amount: 1, reason: "trade-port" });
      },
    }],
    queries: [],
  }),

  "the-forge": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-forge", controllerId: _controllerId, position: { row, col } },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.position?.row === row && ctx.position?.col === col ? 1 : 0,
    } satisfies StatModifierListener],
  }),

  "the-great-library": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-great-library", controllerId: _controllerId, position: { row, col } },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && ctx.position?.row === row && ctx.position?.col === col
        && hasAttribute(ctx.unit, "Knowledge") ? 1 : 0,
    } satisfies StatModifierListener],
  }),

  "versailles": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "versailles", controllerId: _controllerId, position: { row, col } },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && ctx.position?.row === row && ctx.position?.col === col
        && hasAttribute(ctx.unit, "Politics") ? 1 : 0,
    } satisfies StatModifierListener],
  }),

  "the-arena": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-arena", controllerId: _controllerId, position: { row, col } },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.combat?.role === "attacker"
        && ctx.combat.row === row && ctx.combat.col === col ? 1 : 0,
    } satisfies StatModifierListener],
  }),

  "the-great-wall": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-great-wall", controllerId: _controllerId, position: { row, col } },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.combat?.role === "defender"
        && ctx.combat.row === row && ctx.combat.col === col ? 1 : 0,
    } satisfies StatModifierListener],
  }),

  "the-bazaar": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-bazaar", controllerId: _controllerId, position: { row, col } },
      query: "cost",
      min: 1,
      modify: (state, ctx) => {
        if (ctx.action !== "buy") return 0;
        const cell = state.grid[row]?.[col];
        return cell?.units.some((u) => u.controllerId === ctx.playerId) ? -1 : 0;
      },
    } satisfies CostModifierListener],
  }),

  "machu-picchu": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "machu-picchu", controllerId: _controllerId, position: { row, col } },
      query: "protection",
      isProtected: (_state, ctx) =>
        ctx.kind === "event_target" && ctx.position.row === row && ctx.position.col === col,
    } satisfies ProtectionListener],
  }),

  "the-catacombs": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "the-catacombs", controllerId: _controllerId, position: { row, col } },
      query: "protection",
      isProtected: (_state, ctx) =>
        ctx.kind === "event_injury" && ctx.position.row === row && ctx.position.col === col,
    } satisfies ProtectionListener],
  }),

  "sherwood-forest": (_loc, _controllerId, row, col) => ({
    listeners: [],
    queries: [{
      source: { type: "location", cardId: _loc.id, definitionId: "sherwood-forest", controllerId: _controllerId, position: { row, col } },
      query: "protection",
      isProtected: (_state, ctx) =>
        ctx.kind === "contest_target" && ctx.contestStat === "strength"
        && ctx.position.row === row && ctx.position.col === col
        && ctx.unit.cunning >= 7,
    } satisfies ProtectionListener],
  }),

  "alexandria-harbor": (_loc, controllerId) => ({
    listeners: [],
    queries: [],
    reveals: (state, viewerId) => {
      if (viewerId !== controllerId) return {};
      const player = state.players.find((p) => p.id === viewerId);
      const top = player?.mainDeck[0];
      return top ? { mainDeckTop: top } : {};
    },
  }),
};

export const POLICY_EFFECTS: Record<string, PolicyEffectFactory> = {
  "warlord": (policy, controllerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "warlord", controllerId },
      on: "combat_resolved",
      condition: (_state, event) => "winnerId" in event && event.winnerId === controllerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, controllerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: controllerId, amount: 1, reason: "warlord" });
      },
    }],
    queries: [],
  }),

  "healer": (policy, controllerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "healer", controllerId },
      on: "unit_healed",
      condition: (_state, event) => "playerId" in event && event.playerId === controllerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, controllerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: controllerId, amount: 1, reason: "healer" });
      },
    }],
    queries: [],
  }),

  "militarist": (policy, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "militarist", controllerId },
      query: "cost",
      min: 1,
      modify: (_state, ctx) => {
        if (ctx.playerId !== controllerId) return 0;
        const card = ctx.card;
        if (card.type === "unit" && "attributes" in card && hasAttribute(card as UnitCard, "Military")) return -1;
        // Reads the item `type` column (#119). "Weapon" is a governed item type
        // (`card-categories.ts`) but forward-looking — no alpha-1 item carries it
        // yet, so this discount matches nothing today while remaining type-safe.
        if (card.type === "item" && card.itemType?.includes("Weapon")) return -1;
        return 0;
      },
    } satisfies CostModifierListener],
  }),

  "diplomat": (policy, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "diplomat", controllerId },
      query: "cost",
      min: 1,
      modify: (state, ctx) => {
        if (ctx.playerId !== controllerId || ctx.action !== "buy") return 0;
        const card = ctx.card;
        const isPolitics = card.type === "unit" && "attributes" in card && hasAttribute(card as UnitCard, "Politics");
        // TODO(#45): the diplomat discount is also meant to cover "accessory"
        // items, but no such governed item `type` exists yet — "Accessory" is
        // intentionally absent from `ITEM_TYPES` (`card-categories.ts`), so a
        // check against it would be provably dead and rejected by the `ItemType`
        // union. Re-add an item-`type` branch here once #45 promotes a concrete
        // accessory-like type into the governed set.
        if (!isPolitics) return 0;
        return countActionsThisTurn(state, controllerId, (a) => a.type === "buy") === 0 ? -1 : 0;
      },
    } satisfies CostModifierListener],
  }),

  "industrialist": (policy, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "industrialist", controllerId },
      query: "cost",
      min: 1,
      modify: (state, ctx) => {
        if (ctx.playerId !== controllerId || ctx.action !== "buy") return 0;
        return countActionsThisTurn(state, controllerId, (a) => a.type === "buy") === 0 ? -1 : 0;
      },
    } satisfies CostModifierListener],
  }),

  "pioneer": (policy, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "policy", cardId: policy.id, definitionId: "pioneer", controllerId },
      query: "ap",
      modify: (state, ctx) => {
        if (ctx.playerId !== controllerId || ctx.action.type !== "move") return 0;
        return countActionsThisTurn(state, controllerId, (a) => a.type === "move") === 0 ? -99 : 0;
      },
    } satisfies APModifierListener],
  }),

  "scholar": (policy, controllerId) => ({
    listeners: [{
      source: { type: "policy", cardId: policy.id, definitionId: "scholar", controllerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === controllerId,
      apply: (draft, _event, emitFn) => {
        const player = getPlayerById(draft, controllerId);
        const helperEvents: GameEvent[] = [];
        drawOneCard(draft, player, helperEvents);
        for (const e of helperEvents) emitFn(e);
      },
    }],
    queries: [],
  }),
};

/**
 * Passives whose factory reads `pe.targetId` and must be played against a
 * specific location. Co-located with PASSIVE_EVENT_EFFECTS so adding a new
 * targeting passive flags both sides (factory + enumeration) in one place.
 * Consumed by valid-actions.ts `needsLocationTarget`.
 */
export const PASSIVE_EVENTS_NEEDING_LOCATION_TARGET: ReadonlySet<string> = new Set([
  "plague",
]);

export const PASSIVE_EVENT_EFFECTS: Record<string, PassiveEventEffectFactory> = {
  "plague": (pe, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "plague", controllerId },
      query: "stat",
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
    } satisfies StatModifierListener],
  }),

  "arms-race": (pe, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "arms-race", controllerId },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "strength" && ctx.unit.controllerId === controllerId
        && hasAttribute(ctx.unit, "Military") ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "renaissance": (pe, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "renaissance", controllerId },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && ctx.unit.controllerId === controllerId
        && hasAttribute(ctx.unit, "Knowledge") ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "diplomatic-summit": (pe, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "diplomatic-summit", controllerId },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && ctx.unit.controllerId === controllerId
        && hasAttribute(ctx.unit, "Diplomacy") ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "trade-embargo": (pe, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "trade-embargo", controllerId },
      query: "cost",
      modify: (_state, ctx) =>
        ctx.action === "buy" && ctx.playerId !== controllerId ? 2 : 0,
    } satisfies CostModifierListener],
  }),

  "golden-age": (pe, controllerId) => ({
    listeners: [{
      source: { type: "passive_event", cardId: pe.id, definitionId: "golden-age", controllerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === controllerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, controllerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: controllerId, amount: 1, reason: "golden-age" });
      },
    }],
    queries: [],
  }),
};

export const ITEM_EFFECTS: Record<string, ItemEffectFactory> = {
  "ancient-scroll": (item, _controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "ancient-scroll", controllerId: _controllerId },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "cunning" && item.equippedTo === ctx.unit.id ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "spy-glass": (item, controllerId, position) => ({
    listeners: [],
    queries: [],
    reveals: (state, viewerId) => {
      // Only the Spy Glass owner gets reveal rights. Equipped + on grid required:
      // computeReveals (visible-state.ts) passes `position` only for items found
      // via the grid loop; HQ-stored items reach this factory without position
      // so the guard below short-circuits.
      if (viewerId !== controllerId || !item.equippedTo || !position) return {};
      const cell = state.grid[position.row]?.[position.col];
      if (!cell?.location) return {};
      const locationId = cell.location.id;
      const revealedTrapIds: string[] = [];
      for (const player of state.players) {
        if (player.id === viewerId) continue;
        for (const trap of player.activeTraps) {
          if (trap.targetId === locationId) revealedTrapIds.push(trap.card.id);
        }
      }
      return { revealedTrapIds };
    },
  }),

  "war-banner": (item, controllerId, position) => ({
    listeners: [],
    queries: [
      // Equipped: +1 str to friendly units at same location
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "war-banner", controllerId, position },
        query: "stat",
        modify: (_state, ctx) => {
          if (!item.equippedTo || ctx.stat !== "strength" || !position) return 0;
          if (ctx.position?.row !== position.row || ctx.position?.col !== position.col) return 0;
          return ctx.unit.controllerId === controllerId ? 1 : 0;
        },
      } satisfies StatModifierListener,
      // Stored: +2 str to attackers in contests here
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "war-banner", controllerId, position },
        query: "stat",
        modify: (_state, ctx) => {
          if (item.equippedTo || ctx.stat !== "strength" || !position) return 0;
          return ctx.combat?.role === "attacker"
            && ctx.combat.row === position.row && ctx.combat.col === position.col ? 2 : 0;
        },
      } satisfies StatModifierListener,
    ],
  }),

  "holy-relic": (item, controllerId, position) => ({
    listeners: [],
    queries: [
      // Equipped: +3 charisma if Spirituality
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "holy-relic", controllerId, position },
        query: "stat",
        modify: (_state, ctx) =>
          ctx.stat === "charisma" && item.equippedTo === ctx.unit.id
          && hasAttribute(ctx.unit, "Spirituality") ? 3 : 0,
      } satisfies StatModifierListener,
      // Stored: +1 charisma to Spirituality units at location
      {
        source: { type: "item" as const, cardId: item.id, definitionId: "holy-relic", controllerId, position },
        query: "stat",
        modify: (_state, ctx) => {
          if (item.equippedTo || ctx.stat !== "charisma" || !position) return 0;
          if (ctx.position?.row !== position.row || ctx.position?.col !== position.col) return 0;
          return hasAttribute(ctx.unit, "Spirituality") ? 1 : 0;
        },
      } satisfies StatModifierListener,
    ],
  }),

  "philosophers-stone": (item, _controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "philosophers-stone", controllerId: _controllerId },
      query: "stat",
      modify: (_state, ctx) => item.equippedTo === ctx.unit.id ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "crowning-jewel": (item, _controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "item", cardId: item.id, definitionId: "crowning-jewel", controllerId: _controllerId },
      query: "stat",
      modify: (_state, ctx) =>
        ctx.stat === "charisma" && item.equippedTo === ctx.unit.id
        && hasAttribute(ctx.unit, "Politics") ? 2 : 0,
    } satisfies StatModifierListener],
  }),

  "merchant-ledger": (item, controllerId) => ({
    listeners: [{
      source: { type: "item", cardId: item.id, definitionId: "merchant-ledger", controllerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === controllerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, controllerId);
        player.gold += 2;
        emit({ type: "gold_changed", playerId: controllerId, amount: 2, reason: "merchant-ledger" });
      },
    }],
    queries: [],
  }),

  "trade-goods": (item, controllerId) => ({
    listeners: [{
      source: { type: "item", cardId: item.id, definitionId: "trade-goods", controllerId },
      on: "turn_started",
      condition: (_state, event) => "playerId" in event && event.playerId === controllerId,
      apply: (draft, _event, emit) => {
        const player = getPlayerById(draft, controllerId);
        player.gold += 1;
        emit({ type: "gold_changed", playerId: controllerId, amount: 1, reason: "trade-goods" });
      },
    }],
    queries: [],
  }),
};

// ---------------------------------------------------------------------------
// Policy actions — activatable actions surfaced on active policies.
// Keyed by policy definitionId. The action shape mirrors UnitCard.actions.
// CSV-driven extraction of policy actions is tracked in #68; until then,
// actions live here so handleActivate can dispatch them by definitionId.
// ---------------------------------------------------------------------------

export const POLICY_ACTIONS: Record<string, ActionDef[]> = {
  "spymaster": [
    { name: "Infiltrate", apCost: 1, effect: "peek(opponent + hand)" },
  ],
};

// ---------------------------------------------------------------------------
// Unit effects — passives that fire while a unit is in play (HQ or grid).
// ---------------------------------------------------------------------------

export const UNIT_EFFECTS: Record<string, UnitEffectFactory> = {
  "mary-shelley": (unit, controllerId) => ({
    listeners: [],
    queries: [{
      source: { type: "unit", cardId: unit.id, definitionId: "mary-shelley", controllerId },
      query: "ap",
      modify: (state, ctx) => {
        if (ctx.playerId !== controllerId || ctx.action.type !== "play_event") return 0;
        return countActionsThisTurn(state, controllerId, (a) => a.type === "play_event") === 0 ? -99 : 0;
      },
    } satisfies APModifierListener],
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

/** Discard a trap after it fires: remove from activeTraps, push to discard. */
function discardTrap(draft: Draft<MainGameState>, trap: Trap): void {
  for (const player of draft.players) {
    const idx = player.activeTraps.findIndex((t) => t.card.id === trap.card.id);
    if (idx !== -1) {
      player.activeTraps.splice(idx, 1);
      player.discardPile.push(trap.card);
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
  controllerId: string,
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
    controllerId,
  };

  const condition = (state: MainGameState, event: GameEvent): boolean => {
    if (fired) return false;
    if (!("playerId" in event) || event.playerId === controllerId) return false;
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

    // Announce before resolving so the log reads trigger → effect.
    emit({
      type: "trap_triggered",
      playerId: controllerId,
      cardId: trap.card.id,
      cardName: trap.card.name,
      targetId: trap.targetId,
    });
    resolve(draft, cell, unit, dest.row, dest.col, emit);
    discardTrap(draft, trap);
  };

  return [
    { source, on: "unit_entered", condition, apply },
    { source, on: "unit_moved", condition, apply },
  ];
}

export const TRAP_EFFECTS: Record<string, TrapEffectFactory> = {
  "ambush": (trap, controllerId) => ({
    listeners: makeEntryTrapListeners(trap, controllerId, (draft, cell, unit, row, col, emit) => {
      if (unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(unit, emit);
      }
    }),
    queries: [],
  }),

  "assassination-attempt": (trap, controllerId) => ({
    listeners: makeEntryTrapListeners(trap, controllerId, (draft, cell, unit, row, col, emit) => {
      if (unit.strength <= 6 || unit.injured) {
        killUnit(draft, cell, unit, row, col, emit);
      } else {
        injureUnit(unit, emit);
      }
    }),
    queries: [],
  }),

  "highway-robbery": (trap, controllerId) => ({
    listeners: makeEntryTrapListeners(trap, controllerId, (draft, _cell, unit, _row, _col, emit) => {
      const victim = getPlayerById(draft, unit.controllerId);
      const trapOwner = getPlayerById(draft, controllerId);
      const stolen = Math.min(2, victim.gold);
      victim.gold -= stolen;
      trapOwner.gold += stolen;
      if (stolen > 0) {
        emit({ type: "gold_changed", playerId: unit.controllerId, amount: -stolen, reason: "highway-robbery" });
        emit({ type: "gold_changed", playerId: controllerId, amount: stolen, reason: "highway-robbery" });
      }
    }),
    queries: [],
  }),
};
