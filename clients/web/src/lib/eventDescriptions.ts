import type { CombatSide, ContestSide, GameEvent, ModifierEntry } from "cards-engine";

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
  // Standard playerId field
  if ("playerId" in event && event.playerId === selfPlayerId) return "player";
  if ("playerId" in event) return "opponent";
  // Combat events use attackerId/controllerId instead of playerId
  if ("attackerId" in event && event.attackerId === selfPlayerId) return "player";
  if ("attackerId" in event) return "opponent";
  if ("controllerId" in event && event.controllerId === selfPlayerId) return "player";
  if ("controllerId" in event) return "opponent";
  return "system";
}

export interface NameResolvers {
  card?: (id: string) => string;
  player?: (id: string) => string;
  /** Return the location name at (row, col), or `null` if the cell is
   *  in-grid but unnamed (no location placed). Engine-side bounds checks
   *  guarantee off-grid coordinates never reach the renderer, so the
   *  null/missing case strictly means "unnamed", not "unknown". */
  cell?: (row: number, col: number) => string | null;
}

function c(id: string, r?: NameResolvers): string {
  return r?.card?.(id) ?? id;
}

function p(id: string, r?: NameResolvers): string {
  return r?.player?.(id) ?? id;
}

/** "Location Name (row,col)" when the cell has a known location, else "(row,col)". */
function cell(row: number, col: number, r?: NameResolvers): string {
  const name = r?.cell?.(row, col);
  return name ? `${name} (${row},${col})` : `(${row},${col})`;
}

function formatModifier(m: ModifierEntry): string {
  const sign = m.delta > 0 ? "+" : "−";
  return ` ${sign} ${Math.abs(m.delta)} ${m.source.definitionId}`;
}

/**
 * `Name: base ± mod1 source1 ± mod2 source2 + roll🎲 = power`
 * Used for combat pairs and DSL contest lines so the math is identical
 * across surfaces.
 */
function formatSideBreakdown(
  unitId: string,
  base: number,
  modifiers: readonly ModifierEntry[],
  roll: number,
  power: number,
  r?: NameResolvers,
): string {
  const modsStr = modifiers.map(formatModifier).join("");
  return `${c(unitId, r)}: ${base}${modsStr} + ${roll}🎲 = ${power}`;
}

function formatCombatSide(side: CombatSide, r?: NameResolvers): string {
  return formatSideBreakdown(side.unitId, side.baseStrength, side.modifiers, side.roll, side.power, r);
}

function formatContestSide(side: ContestSide, r?: NameResolvers): string {
  return formatSideBreakdown(side.unitId, side.baseStat, side.modifiers, side.roll, side.power, r);
}

export function describeEvent(event: GameEvent, r?: NameResolvers): string {
  switch (event.type) {
    case "card_deployed":
      return `${p(event.playerId, r)} deployed ${c(event.cardId, r)}`;
    case "card_bought":
      // `cardName` is carried inline because the bought card lands in the
      // buyer's hand, which is redacted from other viewers — the card
      // resolver can't resolve `cardId` post-buy.
      return `${p(event.playerId, r)} bought ${event.cardName} for ${event.cost}g`;
    case "card_drawn":
      // Post-scrub `cardId` presence is the drawer signal — don't switch
      // to a `playerId === self` check, which would misbehave against the
      // god-view stream.
      return event.cardId
        ? `You drew ${c(event.cardId, r)}`
        : `${p(event.playerId, r)} drew ${event.count} card(s)`;
    case "unit_entered":
      return `${p(event.playerId, r)} entered ${c(event.unitId, r)} at ${cell(event.row, event.col, r)}`;
    case "unit_moved":
      return `${p(event.playerId, r)} moved ${c(event.unitId, r)} to ${cell(event.toRow, event.toCol, r)}`;
    case "unit_injured":
      return `${c(event.unitId, r)} (${p(event.controllerId, r)}) was injured`;
    case "unit_killed":
      return `${c(event.unitId, r)} (${p(event.controllerId, r)}) was killed`;
    case "unit_healed":
      return `${p(event.playerId, r)} healed ${c(event.unitId, r)}`;
    case "event_played":
      return `${p(event.playerId, r)} played ${c(event.cardId, r)}`;
    case "trap_set":
      return `${p(event.playerId, r)} set a trap${event.targetId ? ` on ${c(event.targetId, r)}` : ""}`;
    case "trap_triggered":
      return `${event.cardName} triggered${event.targetId ? ` on ${c(event.targetId, r)}` : ""}`;
    case "item_equipped":
      return `${p(event.playerId, r)} equipped ${c(event.itemId, r)} on ${c(event.unitId, r)}`;
    case "item_dropped":
      return `${c(event.itemId, r)} dropped at ${cell(event.row, event.col, r)}`;
    case "location_placed":
      return `${c(event.cardId, r)} placed at ${cell(event.row, event.col, r)}`;
    case "location_razed":
      return `${c(event.cardId, r)} razed at ${cell(event.row, event.col, r)}`;
    case "mission_completed":
      return `${p(event.playerId, r)} completed mission at ${c(event.locationId, r)} for ${event.vp} VP`;
    case "mission_attempt_failed":
      return `${p(event.playerId, r)} failed mission attempt at ${cell(event.row, event.col, r)}`;
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
    case "card_activated": {
      const targetClause = event.target
        ? event.target.kind === "card"
          ? ` on ${c(event.target.id, r)}`
          : ` at ${cell(event.target.row, event.target.col, r)}`
        : "";
      return `${p(event.playerId, r)} used ${event.cardName} (${event.actionName})${targetClause}`;
    }
    case "combat_started":
      return `Combat at ${cell(event.row, event.col, r)}: ${p(event.attackerId, r)} vs ${p(event.defenderId, r)}`;
    case "combat_resolved":
      return `Combat resolved at ${cell(event.row, event.col, r)}: ${event.winnerId ? `winner ${p(event.winnerId, r)}` : "draw"}`;
    case "combat_pair_resolved": {
      const left = formatCombatSide(event.attacker, r);
      const right = formatCombatSide(event.defender, r);
      const tail =
        event.outcome === "tie"
          ? " → tie"
          : event.outcome === "kill_defender"
            ? ` → ${c(event.defender.unitId, r)} killed`
            : event.outcome === "kill_attacker"
              ? ` → ${c(event.attacker.unitId, r)} killed`
              : event.outcome === "injure_defender"
                ? ` → ${c(event.defender.unitId, r)} injured`
                : ` → ${c(event.attacker.unitId, r)} injured`;
      return `${left} vs ${right}${tail}`;
    }
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
    case "card_discarded":
      return `${p(event.playerId, r)} discarded ${c(event.cardId, r)} (${event.reason})`;
    case "unit_buffed":
      return `${c(event.unitId, r)} got ${event.delta > 0 ? "+" : ""}${event.delta} ${event.stat}`;
    case "cards_peeked":
      return `${p(event.playerId, r)} peeked at ${event.cardIds.length} card(s)`;
    case "cards_picked":
      return `${p(event.playerId, r)} picked ${event.cardIds.length} card(s)`;
    case "unit_controlled":
      return `${p(event.controllerId, r)} took control of ${c(event.unitId, r)}`;
    case "contest_resolved": {
      // Prefer the per-side breakdown when present (new payload). Fall back
      // to the flat-power line for any in-flight saved games written before
      // the enriched payload landed.
      if (event.attacker && event.defender) {
        const left = formatContestSide(event.attacker, r);
        const right = formatContestSide(event.defender, r);
        return `${event.stat} contest: ${left} vs ${right} → ${c(event.winnerId, r)} wins`;
      }
      return `${event.stat} contest: ${c(event.attackerId, r)} (${event.attackerPower}) vs ${c(event.defenderId, r)} (${event.defenderPower}) — ${c(event.winnerId, r)} wins`;
    }
    default:
      return `Unknown event: ${(event as { type: string }).type}`;
  }
}
