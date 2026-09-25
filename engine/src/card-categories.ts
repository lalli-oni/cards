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
 * Card types that go into a player's main deck, and so may carry a `copies`
 * allowance. Locations reach the grid through the prospect deck and policies
 * are single global cards, so neither is one of these — see
 * `library/schema.md` § Main-Body Columns.
 *
 * Lives here for the same reason as the vocabularies above: the build and the
 * engine each gate on this set, and a copy in each would fail *open* — a type
 * missing from the build's list loses the column silently.
 */
export const MAIN_BODY_TYPES = ["unit", "item", "event"] as const;

/**
 * Where an event card goes when it resolves — its lifecycle destination, a
 * governed property of every event (peer of `timing`/`duration`, not a
 * keyword). `discard` is the default (the normal fate); `main-top` returns the
 * card to the top of the owner's main deck so it can be redrawn and replayed.
 * v0.1 vocabulary — `hand`/`exile` are deferred post-v0.1 (#239); `main-bottom`
 * was rejected as equivalent to `discard` after reshuffle (#231). Runtime
 * routing is wired in #212 (event-resolution sub-scope tracked under #231).
 */
export const EVENT_RESOLUTIONS = ["discard", "main-top"] as const;

/**
 * Multi-value item `type` (per the #45 item-type decision — a single `type`
 * column, not `item_type` + `slot`). `Weapon`/`Armor`/`Tool` are forward-looking
 * values (no alpha-1 item carries them yet) but are governed, so a card *may*
 * carry them and validate. `Accessory` is intentionally NOT in this set — it is
 * an ungoverned, aspirational value pending the #45 item-type decision, so a
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
export type EventResolution = (typeof EVENT_RESOLUTIONS)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
