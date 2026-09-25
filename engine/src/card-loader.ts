import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDef,
  Card,
  CardType,
  EventTiming,
  InstantEventCard,
  ItemCard,
  LocationCard,
  LocationEdges,
  PassiveDef,
  PassiveEventCard,
  PolicyCard,
  Rarity,
  TrapEventCard,
  UnitCard,
} from "./types";
import { ATTRIBUTES, type Attribute } from "./attributes";
import {
  LOCATION_TYPES,
  EVENT_TYPES,
  ITEM_TYPES,
  MAIN_BODY_TYPES,
  type LocationType,
  type EventType,
  type ItemType,
} from "./card-categories";

// ---------------------------------------------------------------------------
// Card definition — the raw JSON shape produced by library/build.ts
// ---------------------------------------------------------------------------

export interface CardDefinition {
  id: string;
  name: string;
  set: string;
  type: CardType;
  rarity: Rarity;
  cost: string | string[];
  text: string | null;
  flavor: string | null;
  // Shared classification (split out of the old `keywords` column in #119).
  keywords: string[];
  attributes?: string[];

  /** Main-body only (unit/item/event) — see library/schema.md. Absent means the
   *  baseline 1; the library build always emits it on those types. */
  copies?: number;

  // Unit fields
  strength?: number | null;
  cunning?: number | null;
  charisma?: number | null;
  actions?: ActionDef[];
  /** Named passive abilities (`name:effect`). Display-only prose today. */
  passives?: PassiveDef[];

  // Location fields
  mission?: string | null;
  requirements?: string | null;
  rewards?: string | null;
  passive?: string | null;
  /** CSV `edges` column: the compass points that are *blocked*. Inverted into
   *  `LocationCard.edges` (where true = open) at instantiation. */
  edges?: string[];
  /** CSV `location_type` column. Named `locationType` in-engine (camelCase). */
  locationType?: string | null;

  // Item fields
  equip?: string | null;
  stored?: string | null;
  /** CSV `type` column, parsed to an array. Named `itemType` to avoid
   *  colliding with the card-type discriminant. */
  itemType?: string[];

  // Event fields
  timing?: EventTiming;
  duration?: number | null;
  trigger?: string | null;
  /** CSV `event_type` column. Named `eventType` in-engine (camelCase). */
  eventType?: string | null;

  // Policy fields
  effect?: string;
  /** CSV `seeding_effect` column. Prose, like `effect`. */
  seedingEffect?: string | null;
}

// ---------------------------------------------------------------------------
// Instance counter — caller-owned, deterministic
// ---------------------------------------------------------------------------

export interface InstanceCounter {
  value: number;
}

export function createInstanceCounter(): InstanceCounter {
  return { value: 0 };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_TYPES: CardType[] = ["unit", "location", "item", "event", "policy"];
const VALID_RARITIES: Rarity[] = ["common", "rare", "legendary"];
const VALID_TIMINGS: EventTiming[] = ["instant", "passive", "trap"];

export class CardValidationError extends Error {
  constructor(public readonly errors: { cardId: string; message: string }[]) {
    super(
      `Card validation failed:\n${errors.map((e) => `  [${e.cardId}] ${e.message}`).join("\n")}`,
    );
    this.name = "CardValidationError";
  }
}

function validateDefinition(
  def: Record<string, unknown>,
): { cardId: string; message: string }[] {
  const errors: { cardId: string; message: string }[] = [];
  const cardId = (def.id as string) || "unknown";

  if (!def.id || typeof def.id !== "string") {
    errors.push({ cardId, message: "missing or invalid id" });
  }
  if (!def.name || typeof def.name !== "string") {
    errors.push({ cardId, message: "missing or invalid name" });
  }
  if (!def.set || typeof def.set !== "string") {
    errors.push({ cardId, message: "missing or invalid set" });
  }
  if (!VALID_TYPES.includes(def.type as CardType)) {
    errors.push({ cardId, message: `invalid type: ${def.type}` });
  }
  if (!VALID_RARITIES.includes(def.rarity as Rarity)) {
    errors.push({ cardId, message: `invalid rarity: ${def.rarity}` });
  }

  // Cost: required, must be string or string[]
  if (def.cost === undefined || def.cost === null) {
    errors.push({ cardId, message: "missing cost" });
  } else if (typeof def.cost !== "string" && !Array.isArray(def.cost)) {
    errors.push({ cardId, message: `invalid cost type: ${typeof def.cost}` });
  }

  // Keywords: required, must be string[] (build.ts always emits an array).
  if (!Array.isArray(def.keywords)) {
    errors.push({
      cardId,
      message: "missing or invalid keywords (expected array)",
    });
  }

  // Attributes: optional, but must be string[] when present.
  if (def.attributes !== undefined && !Array.isArray(def.attributes)) {
    errors.push({
      cardId,
      message: "invalid attributes (expected array)",
    });
  }

  // Governed-vocabulary checks. `library/build.ts` is the canonical gate, but
  // the engine re-validates so hand-edited or stale JSON can't smuggle an
  // out-of-vocab value past the loader and silently no-op an effect (the exact
  // failure the #119 split set out to close). Exact CamelCase membership — the
  // same canonical spelling build enforces; case-insensitive matching exists
  // only for runtime effect application (`hasAttribute`), not for this gate.
  if (Array.isArray(def.attributes)) {
    for (const attr of def.attributes as string[]) {
      if (!ATTRIBUTES.includes(attr as Attribute)) {
        errors.push({ cardId, message: `invalid attribute: ${attr}` });
      }
    }
  }
  if (
    def.type === "location" &&
    def.locationType != null &&
    !LOCATION_TYPES.includes(def.locationType as LocationType)
  ) {
    errors.push({ cardId, message: `invalid location_type: ${def.locationType}` });
  }
  if (
    def.type === "event" &&
    def.eventType != null &&
    !EVENT_TYPES.includes(def.eventType as EventType)
  ) {
    errors.push({ cardId, message: `invalid event_type: ${def.eventType}` });
  }
  if (def.type === "item" && Array.isArray(def.itemType)) {
    for (const t of def.itemType as string[]) {
      if (!ITEM_TYPES.includes(t as ItemType)) {
        errors.push({ cardId, message: `invalid item type: ${t}` });
      }
    }
  }

  // `copies` is main-body only and must be a positive integer. The library
  // build is the canonical gate; re-checked here for the same reason as the
  // vocabularies above — hand-edited or stale JSON shouldn't be able to put a
  // deck-copy count on a location, or a nonsensical one on anything.
  if (def.copies !== undefined) {
    if (!MAIN_BODY_TYPES.includes(def.type as (typeof MAIN_BODY_TYPES)[number])) {
      errors.push({ cardId, message: `copies is not allowed on ${def.type} cards` });
    } else if (
      typeof def.copies !== "number" ||
      !Number.isInteger(def.copies) ||
      def.copies < 1
    ) {
      errors.push({ cardId, message: `invalid copies: ${def.copies} (expected a positive integer)` });
    }
  }

  // Type-specific validation
  if (def.type === "unit") {
    if (typeof def.strength !== "number") {
      errors.push({ cardId, message: `unit missing numeric strength` });
    }
    if (typeof def.cunning !== "number") {
      errors.push({ cardId, message: `unit missing numeric cunning` });
    }
    if (typeof def.charisma !== "number") {
      errors.push({ cardId, message: `unit missing numeric charisma` });
    }
  }
  if (
    def.type === "event" &&
    !VALID_TIMINGS.includes(def.timing as EventTiming)
  ) {
    errors.push({ cardId, message: `invalid event timing: ${def.timing}` });
  }
  if (
    def.type === "policy" &&
    (!def.effect || typeof def.effect !== "string")
  ) {
    errors.push({ cardId, message: "policy missing effect" });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load card definitions from a single JSON file (e.g. library/build/alpha-1.json).
 * Validates each definition and throws CardValidationError if any are invalid.
 */
export function loadCardDefinitions(jsonPath: string): CardDefinition[] {
  if (!existsSync(jsonPath)) {
    throw new Error(`Card definitions file not found: ${jsonPath}`);
  }

  const raw = readFileSync(jsonPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Failed to parse ${jsonPath}: ${e instanceof Error ? e.message : e}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in ${jsonPath}`);
  }

  return validateCardDefinitions(parsed);
}

/**
 * Validate already-parsed definitions and narrow them to `CardDefinition[]`,
 * throwing `CardValidationError` if any are invalid.
 *
 * Split out of `loadCardDefinitions` so a caller that gets the JSON some other
 * way — a bundler importing `all.json`, say — runs the same gate instead of
 * asserting the type and hoping. Without it, the only check on those cards is
 * the build that produced the file, which the caller has no way to confirm ran.
 */
export function validateCardDefinitions(defs: unknown[]): CardDefinition[] {
  const allErrors: { cardId: string; message: string }[] = [];
  const seenIds = new Set<string>();

  for (const entry of defs) {
    allErrors.push(...validateDefinition(entry as Record<string, unknown>));
    const id = (entry as Record<string, unknown>).id as string;
    if (id) {
      if (seenIds.has(id)) {
        allErrors.push({ cardId: id, message: `duplicate card id` });
      }
      seenIds.add(id);
    }
  }

  if (allErrors.length > 0) {
    throw new CardValidationError(allErrors);
  }

  return defs as CardDefinition[];
}

/**
 * Load card definitions from the library build directory.
 * If sets are specified, loads only those sets. Otherwise loads all.json.
 */
export function loadCardDefinitionsFromBuild(
  buildDir: string,
  sets?: string[],
): CardDefinition[] {
  if (!existsSync(buildDir)) {
    throw new Error(
      `Build directory not found: ${buildDir}. Run 'bun library/build.ts' first.`,
    );
  }

  if (sets && sets.length > 0) {
    const defs: CardDefinition[] = [];
    for (const set of sets) {
      defs.push(...loadCardDefinitions(join(buildDir, `${set}.json`)));
    }
    return defs;
  }

  return loadCardDefinitions(join(buildDir, "all.json"));
}

// ---------------------------------------------------------------------------
// Instantiation — convert definitions to engine Card instances
// ---------------------------------------------------------------------------

/** The CSV names the *blocked* compass points; the engine stores open/closed.
 *  An absent or empty list means every edge is open. */
function blockedToEdges(blocked: string[] | undefined): LocationEdges {
  const isBlocked = (edge: string): boolean => (blocked ?? []).includes(edge);
  return {
    n: !isBlocked("N"),
    e: !isBlocked("E"),
    s: !isBlocked("S"),
    w: !isBlocked("W"),
  };
}

/** Normalize cost to string (join alternatives with |). */
function normalizeCost(cost: string | string[]): string {
  return Array.isArray(cost) ? cost.join("|") : cost;
}

/**
 * Convert a card definition into an engine Card instance.
 * Assigns a sequential instance ID from the provided counter.
 */
export function instantiateCard(
  def: CardDefinition,
  ownerId: string,
  counter: InstanceCounter,
): Card {
  const base = {
    id: String(++counter.value),
    definitionId: def.id,
    name: def.name,
    cost: normalizeCost(def.cost),
    rarity: def.rarity,
    text: def.text ?? undefined,
    // Optional-chained so a def constructed outside `loadCardDefinitions`
    // (which guarantees an array) yields `undefined` instead of throwing an
    // opaque, card-id-less TypeError.
    keywords: def.keywords?.length ? def.keywords : undefined,
    // Cast is safe: `validateDefinition` has already gated these values against
    // the governed vocabularies (`ATTRIBUTES`), so the raw string[] holds only
    // valid members by the time instantiation runs through the loader.
    attributes:
      def.attributes && def.attributes.length > 0
        ? (def.attributes as Attribute[])
        : undefined,
    ownerId,
    controllerId: ownerId,
  };

  switch (def.type) {
    case "unit":
      return {
        ...base,
        type: "unit",
        copies: def.copies,
        strength: def.strength ?? 0,
        cunning: def.cunning ?? 0,
        charisma: def.charisma ?? 0,
        attributes: (def.attributes ?? []) as Attribute[],
        injured: false,
        actions: def.actions ?? undefined,
        passives: def.passives ?? undefined,
      } satisfies UnitCard;

    case "location":
      return {
        ...base,
        type: "location",
        edges: blockedToEdges(def.edges),
        requirements: def.requirements ?? def.mission ?? undefined,
        rewards: def.rewards ?? undefined,
        passive: def.passive ?? undefined,
        locationType: (def.locationType ?? undefined) as LocationType | undefined,
      } satisfies LocationCard;

    case "item":
      return {
        ...base,
        type: "item",
        copies: def.copies,
        equip: def.equip ?? undefined,
        stored: def.stored ?? undefined,
        itemType:
          def.itemType && def.itemType.length > 0
            ? (def.itemType as ItemType[])
            : undefined,
        actions: def.actions ?? undefined,
      } satisfies ItemCard;

    case "event": {
      if (!def.timing) {
        throw new Error(`Event card "${def.id}" missing required timing`);
      }
      switch (def.timing) {
        case "instant":
          return { ...base, type: "event", timing: "instant", copies: def.copies, eventType: (def.eventType ?? undefined) as EventType | undefined, effect: def.effect ?? undefined } satisfies InstantEventCard;
        case "passive":
          return {
            ...base,
            type: "event",
            timing: "passive",
            copies: def.copies,
            eventType: (def.eventType ?? undefined) as EventType | undefined,
            duration: def.duration ?? 1,
          } satisfies PassiveEventCard;
        case "trap":
          return {
            ...base,
            type: "event",
            timing: "trap",
            copies: def.copies,
            eventType: (def.eventType ?? undefined) as EventType | undefined,
            trigger: def.trigger ?? "",
          } satisfies TrapEventCard;
        default:
          throw new Error(`Event card "${def.id}" has unknown timing "${def.timing}"`);
      }
    }

    case "policy":
      if (!def.effect) {
        throw new Error(`Policy card "${def.id}" missing required effect`);
      }
      return {
        ...base,
        type: "policy",
        effect: def.effect,
        seedingEffect: def.seedingEffect ?? undefined,
        actions: def.actions ?? undefined,
      } satisfies PolicyCard;
  }
}

/**
 * Instantiate an array of card definitions for a given owner.
 * Returns engine Card instances with unique IDs.
 */
export function instantiateCards(
  defs: CardDefinition[],
  ownerId: string,
  counter: InstanceCounter,
): Card[] {
  return defs.map((def) => instantiateCard(def, ownerId, counter));
}
