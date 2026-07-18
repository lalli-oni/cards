import { type MainGameState, type Stat, STAT_NAMES, type UnitCard } from "./types";
import type { QueryListener } from "./listeners/types";
import { getModifiedStat } from "./listeners/query";
import { hasAttribute, isAttribute } from "./attributes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissionRequirement =
  | { kind: "attribute"; attribute: string; count: number }
  | { kind: "stat"; stat: Stat; threshold: number }
  | { kind: "units"; count: number };

export interface ParsedRewards {
  vp: number;
}

const STATS = new Set<string>(STAT_NAMES);

// ---------------------------------------------------------------------------
// Requirement parser
// ---------------------------------------------------------------------------

/**
 * Parse a requirements string into atomic checks.
 * Format: semicolon-separated checks, e.g. "military_1;strength_15"
 *
 * Also supports legacy coupled formats for backward compat:
 *   "military_strength_15" → [attribute("Military", 1), stat("strength", 15)]
 *   "cunning_unit_7"       → [stat("cunning", 7)]
 */
export function parseRequirements(requirementsString: string): MissionRequirement[] {
  const parts = requirementsString.split(";");
  const requirements: MissionRequirement[] = [];

  for (const part of parts) {
    requirements.push(...parseAtomicCheck(part.trim()));
  }

  if (requirements.length === 0) {
    throw new Error(`No requirements parsed from "${requirementsString}"`);
  }

  return requirements;
}

/**
 * Parse a single atomic check. May return multiple requirements
 * for legacy coupled formats (e.g. "military_strength_15" → 2 checks).
 */
function parseAtomicCheck(check: string): MissionRequirement[] {
  const tokens = check.split("_");
  let i = 0;
  const results: MissionRequirement[] = [];

  while (i < tokens.length) {
    const token = tokens[i];

    // "units" prefix — unit count
    if (token === "units") {
      i++;
      const count = Number(tokens[i]);
      if (Number.isNaN(count)) {
        throw new Error(`Expected number after "units" in "${check}"`);
      }
      results.push({ kind: "units", count });
      i++;
      continue;
    }

    // Stat name as first token — pure stat check or legacy "stat_unit_N"
    if (STATS.has(token)) {
      const stat = token as Stat;
      i++;
      if (i < tokens.length && tokens[i] === "unit") {
        // Legacy: "cunning_unit_7" → stat check (sum, not single-unit)
        i++;
      }
      const threshold = Number(tokens[i]);
      if (Number.isNaN(threshold)) {
        throw new Error(`Expected number after "${stat}" in "${check}"`);
      }
      results.push({ kind: "stat", stat, threshold });
      i++;
      continue;
    }

    // Attribute name — must be one of the governed attributes. Rejecting
    // unknown tokens here turns a silently-unwinnable mission (a typo or an
    // un-migrated role-noun matches zero units) into a loud parse error.
    const attribute = capitalize(token);
    if (!isAttribute(attribute)) {
      throw new Error(
        `Unknown attribute "${attribute}" in "${check}" — not a governed attribute (see rules/attributes.md)`,
      );
    }
    i++;

    if (i >= tokens.length) {
      throw new Error(`Unexpected end after attribute "${attribute}" in "${check}"`);
    }

    // Check if next token is a stat name → legacy coupled format
    if (STATS.has(tokens[i])) {
      const stat = tokens[i] as Stat;
      i++;
      const threshold = Number(tokens[i]);
      if (Number.isNaN(threshold)) {
        throw new Error(`Expected number after "${attribute}_${stat}" in "${check}"`);
      }
      // Decompose: attribute count 1 + stat threshold
      results.push({ kind: "attribute", attribute, count: 1 });
      results.push({ kind: "stat", stat, threshold });
      i++;
      continue;
    }

    // Attribute count: "knowledge_2"
    const count = Number(tokens[i]);
    if (Number.isNaN(count)) {
      throw new Error(`Expected number or stat after "${attribute}" in "${check}", got "${tokens[i]}"`);
    }
    results.push({ kind: "attribute", attribute, count });
    i++;
  }

  return results;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Rewards parser
// ---------------------------------------------------------------------------

/**
 * Parse a rewards string. Currently only supports VP.
 * Format: "4vp" or "4VP"
 */
export function parseRewards(rewardsString: string): ParsedRewards {
  const match = rewardsString.trim().match(/^(\d+)\s*vp$/i);
  if (!match) {
    throw new Error(`Invalid rewards format "${rewardsString}" — expected "Nvp" (e.g. "4vp")`);
  }
  return { vp: Number(match[1]) };
}

// ---------------------------------------------------------------------------
// Requirement checker
// ---------------------------------------------------------------------------

/**
 * Check if a set of units at a location meets all mission requirements.
 * When state/queries/position are provided, stat checks use modified values.
 */
export function checkMissionRequirements(
  requirements: MissionRequirement[],
  units: UnitCard[],
  state?: MainGameState,
  queries?: QueryListener[],
  position?: { row: number; col: number },
): boolean {
  return requirements.every((req) => checkSingleRequirement(req, units, state, queries, position));
}

function checkSingleRequirement(
  req: MissionRequirement,
  units: UnitCard[],
  state?: MainGameState,
  queries?: QueryListener[],
  position?: { row: number; col: number },
): boolean {
  switch (req.kind) {
    case "attribute": {
      const matching = units.filter((u) => hasAttribute(u, req.attribute));
      return matching.length >= req.count;
    }

    case "stat": {
      const total = units.reduce((sum, u) => {
        if (state && queries) {
          return sum + getModifiedStat(state, queries, u, req.stat, position);
        }
        return sum + u[req.stat];
      }, 0);
      return total >= req.threshold;
    }

    case "units":
      return units.length >= req.count;
  }
}
