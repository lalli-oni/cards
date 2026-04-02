const STATS = new Set(["strength", "cunning", "charisma"]);

const STAT_CLASSES: Record<string, string> = {
  strength: "text-stat-strength",
  cunning: "text-stat-cunning",
  charisma: "text-stat-charisma",
};

/**
 * Format a raw mission requirements string into human-readable text.
 *
 * Input formats (separated by ";"):
 *   "scientist_2"   → "2× Scientist"   (attribute count)
 *   "strength_15"   → "Strength ≥ 15"  (stat threshold)
 *   "units_3"       → "3 Units"         (unit count)
 *
 * Splits on the last underscore to handle multi-word attribute names.
 * Unrecognized formats are returned verbatim.
 */
export function formatRequirements(raw: string): string {
  return raw
    .split(";")
    .map((part) => formatOne(part.trim()))
    .join(", ");
}

/**
 * Same as formatRequirements but returns HTML with stat color classes.
 */
export function formatRequirementsHtml(raw: string): string {
  return raw
    .split(";")
    .map((part) => formatOneHtml(part.trim()))
    .join(", ");
}

function formatOne(check: string): string {
  const sep = check.lastIndexOf("_");
  if (sep === -1) return check;

  const key = check.slice(0, sep);
  const value = check.slice(sep + 1);

  // "units_N" → "N Units"
  if (key === "units") {
    return `${value} Units`;
  }

  // "stat_N" → "Stat ≥ N"
  if (STATS.has(key)) {
    return `${capitalize(key)} ≥ ${value}`;
  }

  // "attribute_N" → "N× Attribute"
  return `${value}× ${capitalize(key)}`;
}

function formatOneHtml(check: string): string {
  const sep = check.lastIndexOf("_");
  if (sep === -1) return check;

  const key = check.slice(0, sep);
  const value = check.slice(sep + 1);

  if (key === "units") {
    return `${value} Units`;
  }

  if (STATS.has(key)) {
    const cls = STAT_CLASSES[key] ?? "";
    return `<span class="${cls}">${capitalize(key)} ≥ ${value}</span>`;
  }

  return `${value}× ${capitalize(key)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
