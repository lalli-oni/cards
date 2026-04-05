const STATS = new Set(["strength", "cunning", "charisma"]);

const STAT_CLASSES: Record<string, string> = {
  strength: "text-stat-strength",
  cunning: "text-stat-cunning",
  charisma: "text-stat-charisma",
};

export interface RequirementPart {
  text: string;
  className?: string;
}

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
 * Same as formatRequirements but returns structured parts with optional
 * CSS class names for stat-colored rendering in Svelte templates.
 */
export function parseRequirementParts(raw: string): RequirementPart[] {
  const parts: RequirementPart[] = [];
  const checks = raw.split(";");
  for (let i = 0; i < checks.length; i++) {
    if (i > 0) parts.push({ text: ", " });
    const parsed = formatOnePart(checks[i].trim());
    parts.push(parsed);
  }
  return parts;
}

function formatOne(check: string): string {
  const sep = check.lastIndexOf("_");
  if (sep === -1) return check;

  const key = check.slice(0, sep);
  const value = check.slice(sep + 1);

  if (key === "units") return `${value} Units`;
  if (STATS.has(key)) return `${capitalize(key)} ≥ ${value}`;
  return `${value}× ${capitalize(key)}`;
}

function formatOnePart(check: string): RequirementPart {
  const sep = check.lastIndexOf("_");
  if (sep === -1) return { text: check };

  const key = check.slice(0, sep);
  const value = check.slice(sep + 1);

  if (key === "units") return { text: `${value} Units` };
  if (STATS.has(key)) {
    return { text: `${capitalize(key)} ≥ ${value}`, className: STAT_CLASSES[key] };
  }
  return { text: `${value}× ${capitalize(key)}` };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
