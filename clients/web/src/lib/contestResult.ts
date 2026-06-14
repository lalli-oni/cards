import type {
  CombatPairOutcome,
  GameEvent,
  ModifierEntry,
} from "cards-engine";

export interface PairSideView {
  unitName: string;
  ownerName: string;
  baseStrength: number;
  modifiers: ModifierEntry[];
  roll: number;
  power: number;
  injuredBefore: boolean;
}

export interface PairDetail {
  attacker: PairSideView;
  defender: PairSideView;
  outcome: CombatPairOutcome;
  winnerSide: "attacker" | "defender" | null;
}

export type CombatPairResolved = Extract<GameEvent, { type: "combat_pair_resolved" }>;

export interface NameResolvers {
  card: (id: string) => string;
  player: (id: string) => string;
}

/** Pure — derives a renderer-friendly pair detail from the engine event.
 *  Extracted so the outcome → winnerSide mapping is unit-testable. */
export function buildPairDetail(
  ev: CombatPairResolved,
  resolvers: NameResolvers,
): PairDetail {
  const winnerSide: PairDetail["winnerSide"] =
    ev.outcome === "tie"
      ? null
      : ev.outcome === "kill_defender" || ev.outcome === "injure_defender"
        ? "attacker"
        : "defender";
  return {
    attacker: {
      unitName: resolvers.card(ev.attacker.unitId),
      ownerName: resolvers.player(ev.attackerPlayerId),
      baseStrength: ev.attacker.baseStrength,
      modifiers: ev.attacker.modifiers,
      roll: ev.attacker.roll,
      power: ev.attacker.power,
      injuredBefore: ev.attacker.injuredBefore,
    },
    defender: {
      unitName: resolvers.card(ev.defender.unitId),
      ownerName: resolvers.player(ev.defenderPlayerId),
      baseStrength: ev.defender.baseStrength,
      modifiers: ev.defender.modifiers,
      roll: ev.defender.roll,
      power: ev.defender.power,
      injuredBefore: ev.defender.injuredBefore,
    },
    outcome: ev.outcome,
    winnerSide,
  };
}
