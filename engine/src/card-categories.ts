// ---------------------------------------------------------------------------
// Governed per-type category vocabularies
// ---------------------------------------------------------------------------

/**
 * The per-type classification axis — a card's own kind *within* its card type,
 * distinct from the cross-type `attributes` vocabulary (`attributes.ts`). Split
 * out of the old overloaded `keywords` column in #119.
 *
 * These are the single source of truth: `library/build.ts` validates CSV values
 * against them (exact spelling, case-sensitive) and `engine/src/types.ts`
 * derives the field union types from them, so build, engine types, and effect
 * factories cannot drift on spelling. Governance + mechanical utilization of
 * these categories is tracked post-v0.1 in #160; today they are mostly flavor.
 * Keep the item list in lockstep with `library/schema.md`.
 */
export const LOCATION_TYPES = [
  "Palace",
  "Archive",
  "Arena",
  "Port",
  "Workshop",
  "Hideout",
  "Sanctuary",
  "Monument",
  "Market",
  "Research",
  "Fortification",
] as const;

export const EVENT_TYPES = ["Catastrophe", "Prosperity"] as const;

/**
 * Multi-value item `type` (per the #45 equipment decision — a single `type`
 * column, not `item_type` + `slot`). `Weapon`/`Armor`/`Tool` are forward-looking
 * values (no alpha-1 item carries them yet) but are governed, so a card *may*
 * carry them and validate. `Accessory` is intentionally NOT in this set — it is
 * an ungoverned, aspirational value pending the #45 equipment decision, so a
 * card carrying it fails the build. Effect code therefore cannot key off
 * `"Accessory"` (the union would reject it) until #45 promotes it here.
 */
export const ITEM_TYPES = [
  "Weapon",
  "Armor",
  "Tool",
  "Artifact",
  "Banner",
  "Regalia",
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
