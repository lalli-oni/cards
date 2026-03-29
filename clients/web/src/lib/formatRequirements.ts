const STATS = new Set(["strength", "cunning", "charisma"]);

/**
 * Format a raw mission requirements string into human-readable text.
 *
 * Input formats (separated by ";"):
 *   "scientist_2"   → "2× Scientist"   (attribute count)
 *   "strength_15"   → "Strength ≥ 15"  (stat threshold)
 *   "units_3"       → "3 Units"         (unit count)
 */
export function formatRequirements(raw: string): string {
  return raw
    .split(";")
    .map((part) => formatOne(part.trim()))
    .join(", ");
}

function formatOne(check: string): string {
  const tokens = check.split("_");

  // "units_N" → "N Units"
  if (tokens[0] === "units" && tokens.length === 2) {
    return `${tokens[1]} Units`;
  }

  // "stat_N" → "Stat ≥ N"
  if (tokens.length === 2 && STATS.has(tokens[0])) {
    return `${capitalize(tokens[0])} ≥ ${tokens[1]}`;
  }

  // "attribute_N" → "N× Attribute"
  if (tokens.length === 2) {
    return `${tokens[1]}× ${capitalize(tokens[0])}`;
  }

  // Fallback: return as-is
  return check;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
