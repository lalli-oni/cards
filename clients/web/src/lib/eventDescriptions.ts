import type { GameEvent } from "cards-engine";

export function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case "card_deployed":
      return `${event.playerId} deployed ${event.cardId}`;
    case "card_bought":
      return `${event.playerId} bought ${event.cardId} for ${event.cost}g`;
    case "card_drawn":
      return `${event.playerId} drew ${event.count} card(s)`;
    case "unit_entered":
      return `${event.playerId} entered unit ${event.unitId} at (${event.row},${event.col})`;
    case "unit_moved":
      return `${event.playerId} moved unit ${event.unitId} from (${event.fromRow},${event.fromCol}) to (${event.toRow},${event.toCol})`;
    case "unit_injured":
      return `Unit ${event.unitId} (${event.ownerId}) was injured`;
    case "unit_killed":
      return `Unit ${event.unitId} (${event.ownerId}) was killed`;
    case "unit_healed":
      return `${event.playerId} healed unit ${event.unitId}`;
    case "event_played":
      return `${event.playerId} played event ${event.cardId}`;
    case "trap_set":
      return `${event.playerId} set a trap`;
    case "trap_triggered":
      return `Trap triggered on ${event.targetId ?? "target"}`;
    case "item_equipped":
      return `${event.playerId} equipped ${event.itemId} on unit ${event.unitId}`;
    case "item_dropped":
      return `Item ${event.itemId} dropped at (${event.row},${event.col})`;
    case "location_placed":
      return `Location ${event.cardId} placed at (${event.row},${event.col})`;
    case "location_razed":
      return `Location ${event.cardId} razed at (${event.row},${event.col})`;
    case "mission_completed":
      return `${event.playerId} completed mission at ${event.locationId} for ${event.vp} VP`;
    case "mission_attempt_failed":
      return `${event.playerId} failed mission attempt at (${event.row},${event.col})`;
    case "gold_changed":
      return `${event.playerId} ${event.amount >= 0 ? "+" : ""}${event.amount}g (${event.reason})`;
    case "turn_started":
      return `--- Turn: ${event.playerId} (round ${event.round}) ---`;
    case "turn_ended":
      return `${event.playerId} ended turn`;
    case "phase_changed":
      return `Phase changed: ${event.from} → ${event.to}`;
    case "game_ended":
      return `Game over! Winner: ${event.winner ?? "draw"}`;
    case "deck_shuffled":
      return `${event.playerId} shuffled ${event.deck} deck`;
    case "card_destroyed":
      return `${event.playerId} destroyed ${event.cardId}`;
    case "combat_started":
      return `Combat at (${event.row},${event.col}): ${event.attackerId} vs ${event.defenderId}`;
    case "combat_resolved":
      return `Combat resolved at (${event.row},${event.col}): ${event.winnerId ? `winner ${event.winnerId}` : "draw"}`;
    case "market_replenished":
      return `Market replenished: ${event.cardId} (slot ${event.slotIndex})`;
    case "passive_expired":
      return `Passive effect ${event.cardId} expired (${event.playerId})`;
    case "seed_cards_drawn":
      return `${event.playerId} drew ${event.count} seeding cards`;
    case "seed_kept":
      return `${event.playerId} kept ${event.keptCount}, exposed ${event.exposedCount}`;
    case "seed_stolen":
      return `${event.playerId} stole ${event.cardId}`;
    case "seeding_step_changed":
      return `Seeding step: ${event.step}`;
    case "seeding_player_changed":
      return `Seeding turn: ${event.playerId}`;
    case "prospect_deck_built":
      return `${event.playerId} prospect deck built`;
    case "deck_constructed":
      return `${event.playerId} deck constructed`;
    case "policies_assigned":
      return `${event.playerId} assigned policies: ${event.policyIds.join(", ")}`;
    default:
      return `Unknown event: ${(event as { type: string }).type}`;
  }
}
