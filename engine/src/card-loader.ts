import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDef,
  Card,
  CardType,
  EventSubtype,
  InstantEventCard,
  ItemCard,
  LocationCard,
  PassiveEventCard,
  PolicyCard,
  Rarity,
  TrapEventCard,
  UnitCard,
} from "./types";

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
  keywords: string[];

  // Unit fields
  strength?: number | null;
  cunning?: number | null;
  charisma?: number | null;
  attributes?: string[];
  actions?: ActionDef[];

  // Location fields
  mission?: string | null;
  requirements?: string | null;
  rewards?: string | null;
  passive?: string | null;

  // Item fields
  equip?: string | null;
  stored?: string | null;

  // Event fields
  subtype?: EventSubtype;
  duration?: number | null;
  trigger?: string | null;

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
const VALID_SUBTYPES: EventSubtype[] = ["instant", "passive", "trap"];

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

  // Keywords: required, must be string[]
  if (!Array.isArray(def.keywords)) {
    errors.push({
      cardId,
      message: "missing or invalid keywords (expected array)",
    });
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
    !VALID_SUBTYPES.includes(def.subtype as EventSubtype)
  ) {
    errors.push({ cardId, message: `invalid event subtype: ${def.subtype}` });
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
    keywords: def.keywords.length > 0 ? def.keywords : undefined,
    ownerId,
  };

  switch (def.type) {
    case "unit":
      return {
        ...base,
        type: "unit",
        strength: def.strength ?? 0,
        cunning: def.cunning ?? 0,
        charisma: def.charisma ?? 0,
        attributes: def.attributes ?? [],
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
      } satisfies LocationCard;

    case "item":
      return {
        ...base,
        type: "item",
        equip: def.equip ?? undefined,
        stored: def.stored ?? undefined,
      } satisfies ItemCard;

    case "event": {
      if (!def.subtype) {
        throw new Error(`Event card "${def.id}" missing required subtype`);
      }
      switch (def.subtype) {
        case "instant":
          return { ...base, type: "event", subtype: "instant", effect: def.effect ?? undefined } satisfies InstantEventCard;
        case "passive":
          return {
            ...base,
            type: "event",
            subtype: "passive",
            duration: def.duration ?? 1,
          } satisfies PassiveEventCard;
        case "trap":
          return {
            ...base,
            type: "event",
            subtype: "trap",
            trigger: def.trigger ?? "",
          } satisfies TrapEventCard;
        default:
          throw new Error(`Event card "${def.id}" has unknown subtype "${def.subtype}"`);
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
