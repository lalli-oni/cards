import type {
  GameEvent,
  ModifierEntry,
} from "cards-engine";

/** Renderer-friendly per-side view, shared by combat (multi-pair, strength
 *  only) and DSL stat contests (single-pair, any stat). `baseStat` is the
 *  unit's base strength/charisma/cunning before modifiers and roll.
 *  `injuredBefore` is meaningful for combat (drives the injury-penalty
 *  modifier in the breakdown); for DSL contests it's always false (contests
 *  do not apply injury penalties today — see ContestSide doc in engine). */
export interface PairSideView {
  unitName: string;
  ownerName: string;
  baseStat: number;
  modifiers: ModifierEntry[];
  roll: number;
  power: number;
  injuredBefore: boolean;
}

export interface PairDetail {
  attacker: PairSideView;
  defender: PairSideView;
  winnerSide: "attacker" | "defender" | null;
}

export type CombatPairResolved = Extract<GameEvent, { type: "combat_pair_resolved" }>;
export type ContestResolved = Extract<GameEvent, { type: "contest_resolved" }>;

export interface NameResolvers {
  card: (id: string) => string;
  player: (id: string) => string;
}

/** Pure — derives a renderer-friendly pair detail from a combat_pair_resolved
 *  event. Extracted so the outcome → winnerSide mapping is unit-testable. */
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
      baseStat: ev.attacker.baseStrength,
      modifiers: ev.attacker.modifiers,
      roll: ev.attacker.roll,
      power: ev.attacker.power,
      injuredBefore: ev.attacker.injuredBefore,
    },
    defender: {
      unitName: resolvers.card(ev.defender.unitId),
      ownerName: resolvers.player(ev.defenderPlayerId),
      baseStat: ev.defender.baseStrength,
      modifiers: ev.defender.modifiers,
      roll: ev.defender.roll,
      power: ev.defender.power,
      injuredBefore: ev.defender.injuredBefore,
    },
    winnerSide,
  };
}

/** Pure — derives a renderer-friendly pair detail from a contest_resolved
 *  event. Contests are 1v1, so the dialog renders a single pair. winnerSide
 *  comes directly from the event's winnerId; ties go to the defender per
 *  rules/stat-contests.md, which the engine already encodes (attacker wins
 *  iff atkPower > defPower).
 *
 *  `defenderOwnerName` is passed in because contest_resolved doesn't carry
 *  the defender's controller id (it carries `defenderId`, the unit id, plus
 *  `casterPlayerId` for the attacker side only). The caller looks up the
 *  defender unit's current controller from the grid and resolves the name.
 *  Engine event symmetry with combat_pair_resolved is tracked in #153. */
export function buildPairDetailFromContest(
  ev: ContestResolved,
  resolvers: NameResolvers,
  defenderOwnerName: string,
): PairDetail {
  return {
    attacker: {
      unitName: resolvers.card(ev.attacker.unitId),
      ownerName: resolvers.player(ev.casterPlayerId),
      baseStat: ev.attacker.baseStat,
      modifiers: ev.attacker.modifiers,
      roll: ev.attacker.roll,
      power: ev.attacker.power,
      injuredBefore: false,
    },
    defender: {
      unitName: resolvers.card(ev.defender.unitId),
      ownerName: defenderOwnerName,
      baseStat: ev.defender.baseStat,
      modifiers: ev.defender.modifiers,
      roll: ev.defender.roll,
      power: ev.defender.power,
      injuredBefore: false,
    },
    winnerSide: ev.winnerId === ev.attackerId ? "attacker" : "defender",
  };
}
