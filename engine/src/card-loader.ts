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
  abilities: string[];
  attributes?: string[];

  // Unit fields
  strength?: number | null;
  cunning?: number | null;
  charisma?: number | null;
  actions?: ActionDef[];

  // Location fields
  mission?: string | null;
  requirements?: string | null;
  rewards?: string | null;
  passive?: string | null;
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
const VALID_RARITIES: Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];
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

  // Abilities: required, must be string[] (build.ts always emits an array).
  if (!Array.isArray(def.abilities)) {
    errors.push({
      cardId,
      message: "missing or invalid abilities (expected array)",
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

  const allErrors: { cardId: string; message: string }[] = [];
  const seenIds = new Set<string>();

  for (const entry of parsed) {
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

  return parsed as CardDefinition[];
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
    abilities: def.abilities?.length ? def.abilities : undefined,
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
        strength: def.strength ?? 0,
        cunning: def.cunning ?? 0,
        charisma: def.charisma ?? 0,
        attributes: (def.attributes ?? []) as Attribute[],
        injured: false,
        actions: def.actions ?? undefined,
      } satisfies UnitCard;

    case "location":
      return {
        ...base,
        type: "location",
        edges: { n: true, e: true, s: true, w: true },
        requirements: def.requirements ?? def.mission ?? undefined,
        rewards: def.rewards ?? undefined,
        passive: def.passive ?? undefined,
        locationType: (def.locationType ?? undefined) as LocationType | undefined,
      } satisfies LocationCard;

    case "item":
      return {
        ...base,
        type: "item",
        equip: def.equip ?? undefined,
        stored: def.stored ?? undefined,
        itemType:
          def.itemType && def.itemType.length > 0
            ? (def.itemType as ItemType[])
            : undefined,
      } satisfies ItemCard;

    case "event": {
      if (!def.timing) {
        throw new Error(`Event card "${def.id}" missing required timing`);
      }
      switch (def.timing) {
        case "instant":
          return { ...base, type: "event", timing: "instant", eventType: (def.eventType ?? undefined) as EventType | undefined, effect: def.effect ?? undefined } satisfies InstantEventCard;
        case "passive":
          return {
            ...base,
            type: "event",
            timing: "passive",
            eventType: (def.eventType ?? undefined) as EventType | undefined,
            duration: def.duration ?? 1,
          } satisfies PassiveEventCard;
        case "trap":
          return {
            ...base,
            type: "event",
            timing: "trap",
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
