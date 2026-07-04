// ---------------------------------------------------------------------------
// Governed attribute vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed, canonical vocabulary of governed unit attributes.
 * Source of truth: `rules/attributes.md`. Every value in a unit's
 * `attributes` column and every attribute token in a mission-DSL string
 * must draw from this set. Keep in lockstep with `rules/attributes.md`.
 */
export const ATTRIBUTES = [
  "Knowledge",
  "Military",
  "Diplomacy",
  "Commerce",
  "Politics",
  "Spirituality",
  "Engineering",
  "Exploration",
  "Espionage",
  "Culture",
] as const;

export type Attribute = (typeof ATTRIBUTES)[number];

const ATTRIBUTE_LOOKUP: ReadonlySet<string> = new Set(
  ATTRIBUTES.map((a) => a.toLowerCase()),
);

/** Whether `value` names a governed attribute (case-insensitive). */
export function isAttribute(value: string): boolean {
  return ATTRIBUTE_LOOKUP.has(value.toLowerCase());
}

/**
 * Case-insensitive membership check: does `unit` carry `attribute`?
 *
 * Attribute matching is case-insensitive everywhere — mission requirement
 * checks and effect factories alike — so card data (CSV `attributes` values)
 * and code (hardcoded literals) cannot silently drift apart on casing.
 */
export function hasAttribute(
  unit: { attributes: string[] },
  attribute: string,
): boolean {
  const target = attribute.toLowerCase();
  return unit.attributes.some((a) => a.toLowerCase() === target);
}
