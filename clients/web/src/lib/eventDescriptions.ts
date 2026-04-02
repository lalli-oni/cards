import type { GameEvent } from "cards-engine";

export type EventCategory = "player" | "opponent" | "system";

const SYSTEM_EVENT_TYPES: ReadonlySet<string> = new Set([
  "phase_changed",
  "game_ended",
  "market_replenished",
  "turn_started",
  "turn_ended",
  "seeding_step_changed",
  "seeding_player_changed",
  "prospect_deck_built",
  "deck_constructed",
  "deck_shuffled",
]);

export function categorizeEvent(
  event: GameEvent,
  selfPlayerId: string,
): EventCategory {
  if (SYSTEM_EVENT_TYPES.has(event.type)) return "system";
  if ("playerId" in event && event.playerId === selfPlayerId) return "player";
  if ("playerId" in event) return "opponent";
  return "system";
}

export interface NameResolvers {
  card?: (id: string) => string;
  player?: (id: string) => string;
}

function c(id: string, r?: NameResolvers): string {
  return r?.card?.(id) ?? id;
}

function p(id: string, r?: NameResolvers): string {
  return r?.player?.(id) ?? id;
}

export function describeEvent(event: GameEvent, r?: NameResolvers): string {
  switch (event.type) {
    case "card_deployed":
      return `${p(event.playerId, r)} deployed ${c(event.cardId, r)}`;
    case "card_bought":
      return `${p(event.playerId, r)} bought ${c(event.cardId, r)} for ${event.cost}g`;
    case "card_drawn":
      return `${p(event.playerId, r)} drew ${event.count} card(s)`;
    case "unit_entered":
      return `${p(event.playerId, r)} entered ${c(event.unitId, r)} at (${event.row},${event.col})`;
    case "unit_moved":
      return `${p(event.playerId, r)} moved ${c(event.unitId, r)} to (${event.toRow},${event.toCol})`;
    case "unit_injured":
      return `${c(event.unitId, r)} (${p(event.ownerId, r)}) was injured`;
    case "unit_killed":
      return `${c(event.unitId, r)} (${p(event.ownerId, r)}) was killed`;
    case "unit_healed":
      return `${p(event.playerId, r)} healed ${c(event.unitId, r)}`;
    case "event_played":
      return `${p(event.playerId, r)} played ${c(event.cardId, r)}`;
    case "trap_set":
      return `${p(event.playerId, r)} set a trap`;
    case "trap_triggered":
      return `Trap triggered on ${event.targetId ? c(event.targetId, r) : "target"}`;
    case "item_equipped":
      return `${p(event.playerId, r)} equipped ${c(event.itemId, r)} on ${c(event.unitId, r)}`;
    case "item_dropped":
      return `${c(event.itemId, r)} dropped at (${event.row},${event.col})`;
    case "location_placed":
      return `${c(event.cardId, r)} placed at (${event.row},${event.col})`;
    case "location_razed":
      return `${c(event.cardId, r)} razed at (${event.row},${event.col})`;
    case "mission_completed":
      return `${p(event.playerId, r)} completed mission at ${c(event.locationId, r)} for ${event.vp} VP`;
    case "mission_attempt_failed":
      return `${p(event.playerId, r)} failed mission attempt at (${event.row},${event.col})`;
    case "gold_changed":
      return `${p(event.playerId, r)} ${event.amount >= 0 ? "+" : ""}${event.amount}g (${event.reason})`;
    case "turn_started":
      return `--- Turn: ${p(event.playerId, r)} (round ${event.round}) ---`;
    case "turn_ended":
      return `${p(event.playerId, r)} ended turn`;
    case "phase_changed":
      return `Phase changed: ${event.from} → ${event.to}`;
    case "game_ended":
      return `Game over! Winner: ${event.winner ? p(event.winner, r) : "draw"}`;
    case "deck_shuffled":
      return `${p(event.playerId, r)} shuffled ${event.deck} deck`;
    case "card_destroyed":
      return `${p(event.playerId, r)} destroyed ${c(event.cardId, r)}`;
    case "combat_started":
      return `Combat at (${event.row},${event.col}): ${p(event.attackerId, r)} vs ${p(event.defenderId, r)}`;
    case "combat_resolved":
      return `Combat resolved at (${event.row},${event.col}): ${event.winnerId ? `winner ${p(event.winnerId, r)}` : "draw"}`;
    case "market_replenished":
      return `Market replenished: ${c(event.cardId, r)}`;
    case "passive_expired":
      return `Passive ${c(event.cardId, r)} expired (${p(event.playerId, r)})`;
    case "seed_cards_drawn":
      return `${p(event.playerId, r)} drew ${event.count} seeding cards`;
    case "seed_kept":
      return `${p(event.playerId, r)} kept ${event.keptCount}, exposed ${event.exposedCount}`;
    case "seed_stolen":
      return `${p(event.playerId, r)} stole ${c(event.cardId, r)}`;
    case "seeding_step_changed":
      return `Seeding step: ${event.step}`;
    case "seeding_player_changed":
      return `Seeding turn: ${p(event.playerId, r)}`;
    case "prospect_deck_built":
      return `${p(event.playerId, r)} prospect deck built`;
    case "deck_constructed":
      return `${p(event.playerId, r)} deck constructed`;
    case "policies_assigned":
      return `${p(event.playerId, r)} assigned policies: ${event.policyIds.map((id) => c(id, r)).join(", ")}`;
    default:
      return `Unknown event: ${(event as { type: string }).type}`;
  }
}
