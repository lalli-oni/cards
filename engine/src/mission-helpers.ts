import type { UnitCard } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissionRequirement =
  | { kind: "attribute_count"; attribute: string; count: number }
  | { kind: "attribute_stat"; attribute: string; stat: StatName; threshold: number }
  | { kind: "unit_count"; count: number }
  | { kind: "unit_stat"; stat: StatName; threshold: number }
  | { kind: "different_attributes"; count: number };

type StatName = "strength" | "cunning" | "charisma";

export interface ParsedMission {
  requirements: MissionRequirement[];
  vp: number;
}

const STATS = new Set<string>(["strength", "cunning", "charisma"]);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a mission string like "scientist_2>5" or "warrior_strength_15>4".
 * Returns parsed requirements and VP reward.
 */
export function parseMission(missionString: string): ParsedMission {
  const [specPart, vpPart] = missionString.split(">");
  if (!vpPart) {
    throw new Error(`Invalid mission format — missing ">vp": "${missionString}"`);
  }

  const vp = Number(vpPart);
  if (Number.isNaN(vp) || vp < 0) {
    throw new Error(`Invalid VP value "${vpPart}" in mission "${missionString}"`);
  }

  const requirements = parseRequirementSpec(specPart);
  return { requirements, vp };
}

/**
 * Parse the requirement spec (left side of ">").
 *
 * Patterns:
 *   units_3                    → unit_count(3)
 *   units_3_different_attributes → different_attributes(3)
 *   scientist_2                → attribute_count("Scientist", 2)
 *   warrior_strength_15        → attribute_stat("Warrior", "strength", 15)
 *   cunning_unit_7             → unit_stat("cunning", 7)
 *   scientist_1_diplomat_1     → attribute_count("Scientist", 1) + attribute_count("Diplomat", 1)
 */
function parseRequirementSpec(spec: string): MissionRequirement[] {
  const tokens = spec.split("_");
  const requirements: MissionRequirement[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // "units" prefix — unit count or different_attributes
    if (token === "units") {
      i++;
      const count = Number(tokens[i]);
      if (Number.isNaN(count)) {
        throw new Error(`Expected number after "units" in "${spec}"`);
      }
      i++;
      // Check for "different_attributes" suffix
      if (i < tokens.length && tokens[i] === "different" && tokens[i + 1] === "attributes") {
        requirements.push({ kind: "different_attributes", count });
        i += 2;
      } else {
        requirements.push({ kind: "unit_count", count });
      }
      continue;
    }

    // Stat name as first token — "cunning_unit_7" pattern
    if (STATS.has(token)) {
      const stat = token as StatName;
      i++;
      if (i < tokens.length && tokens[i] === "unit") {
        // unit_stat: "cunning_unit_7"
        i++;
        const threshold = Number(tokens[i]);
        if (Number.isNaN(threshold)) {
          throw new Error(`Expected number after "${stat}_unit" in "${spec}"`);
        }
        requirements.push({ kind: "unit_stat", stat, threshold });
        i++;
      } else {
        throw new Error(`Unexpected token after stat "${stat}" in "${spec}"`);
      }
      continue;
    }

    // Attribute name — could be:
    //   attribute_count: "scientist_2"
    //   attribute_stat:  "warrior_strength_15" or "scientist_cunning_14"
    const attribute = capitalize(token);
    i++;

    if (i >= tokens.length) {
      throw new Error(`Unexpected end after attribute "${attribute}" in "${spec}"`);
    }

    // Check if next token is a stat name → attribute_stat
    if (STATS.has(tokens[i])) {
      const stat = tokens[i] as StatName;
      i++;
      const threshold = Number(tokens[i]);
      if (Number.isNaN(threshold)) {
        throw new Error(`Expected number after "${attribute}_${stat}" in "${spec}"`);
      }
      requirements.push({ kind: "attribute_stat", attribute, stat, threshold });
      i++;
      continue;
    }

    // Otherwise it's a count → attribute_count
    const count = Number(tokens[i]);
    if (Number.isNaN(count)) {
      throw new Error(`Expected number or stat after "${attribute}" in "${spec}", got "${tokens[i]}"`);
    }
    requirements.push({ kind: "attribute_count", attribute, count });
    i++;
  }

  if (requirements.length === 0) {
    throw new Error(`No requirements parsed from "${spec}"`);
  }

  return requirements;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Requirement checker
// ---------------------------------------------------------------------------

/**
 * Check if a set of units at a location meets all mission requirements.
 */
export function checkMissionRequirements(
  requirements: MissionRequirement[],
  units: UnitCard[],
): boolean {
  return requirements.every((req) => checkSingleRequirement(req, units));
}

function checkSingleRequirement(
  req: MissionRequirement,
  units: UnitCard[],
): boolean {
  switch (req.kind) {
    case "attribute_count": {
      const matching = units.filter((u) =>
        u.attributes.some((a) => a.toLowerCase() === req.attribute.toLowerCase()),
      );
      return matching.length >= req.count;
    }

    case "attribute_stat": {
      const matching = units.filter((u) =>
        u.attributes.some((a) => a.toLowerCase() === req.attribute.toLowerCase()),
      );
      const total = matching.reduce((sum, u) => sum + u[req.stat], 0);
      return total >= req.threshold;
    }

    case "unit_count":
      return units.length >= req.count;

    case "unit_stat": {
      return units.some((u) => u[req.stat] >= req.threshold);
    }

    case "different_attributes": {
      const attrSet = new Set<string>();
      for (const u of units) {
        for (const a of u.attributes) {
          attrSet.add(a.toLowerCase());
        }
      }
      return units.length >= req.count && attrSet.size >= req.count;
    }
  }
}
