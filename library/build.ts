#!/usr/bin/env bun
/**
 * Builds JSON from CSV card definitions.
 *
 * Usage:
 *   bun library/build.ts            # build all sets
 *   bun library/build.ts baseline   # build specific set
 *
 * Output goes to library/build/
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseDSL, DSLParseError, DSLValidationError } from "../engine/src/effect-dsl";
import { ATTRIBUTES } from "../engine/src/attributes";

const LIBRARY_DIR = join(import.meta.dir);
const SETS_DIR = join(LIBRARY_DIR, "sets");
const BUILD_DIR = join(LIBRARY_DIR, "build");

const CARD_TYPES = ["units", "locations", "items", "events", "policies"] as const;
type CardType = (typeof CARD_TYPES)[number];

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const EVENT_TIMINGS = ["instant", "passive", "trap"] as const;

// --- Governed per-type category vocabularies ---
// Small closed enums, validated at build time like `rarity`/`timing`. These
// are the *per-type* classification axis (a card's own kind within its type),
// distinct from the cross-type `attributes` vocabulary. Governance + mechanical
// utilization of these categories is tracked post-v0.1 in #160; today they are
// structural/flavor storage split out of the old overloaded `keywords` column.
const LOCATION_TYPES = [
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
const EVENT_TYPES = ["Catastrophe", "Prosperity"] as const;
// Multi-value item `type` (per the #45 equipment decision — a single `type`
// column, not `item_type` + `slot`). Weapon/Armor/Tool are forward-looking
// values (no alpha-1 item carries them yet); Artifact/Banner/Regalia are in use.
// `Accessory` is intentionally NOT governed here — see #45.
const ITEM_TYPES = [
  "Weapon",
  "Armor",
  "Tool",
  "Artifact",
  "Banner",
  "Regalia",
] as const;

// --- CSV parsing ---

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? "";
    });
    return record;
  });
}

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// --- Parsing helpers ---

function splitList(value: string): string[] {
  return value ? value.split(";").map((s) => s.trim()).filter(Boolean) : [];
}

function parseAction(raw: string): { name: string; apCost: number; effect: string } | null {
  const parts = raw.split(":");
  if (parts.length < 3) return null;
  return {
    name: parts[0],
    apCost: parseInt(parts[1], 10),
    effect: parts.slice(2).join(":"),
  };
}

function intOrNull(value: string): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

// --- Card transformers ---

function transformCard(type: CardType, raw: Record<string, string>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: raw.id,
    name: raw.name,
    set: raw.set,
    type: type === "policies" ? "policy" : type.replace(/s$/, ""), // units -> unit, policies -> policy
    rarity: raw.rarity,
    cost: raw.cost.includes("|") ? raw.cost.split("|").map((c) => c.trim()) : raw.cost,
    text: raw.text || null,
    flavor: raw.flavor || null,
    // Shared classification columns (split out of the old `keywords` column):
    // `abilities` = mechanical keyword-effects, `attributes` = cross-type
    // synergy vocabulary. Both apply to every card type.
    abilities: splitList(raw.abilities || ""),
    attributes: splitList(raw.attributes || ""),
  };

  switch (type) {
    case "units":
      base.strength = intOrNull(raw.strength);
      base.cunning = intOrNull(raw.cunning);
      base.charisma = intOrNull(raw.charisma);
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      break;

    case "locations":
      base.requirements = null;
      base.rewards = null;
      if (raw.mission) {
        const parts = raw.mission.split(">");
        if (parts.length !== 2) throw new Error(`${raw.id}: mission "${raw.mission}" must have exactly one ">"`);
        if (!/^\d+$/.test(parts[1].trim())) throw new Error(`${raw.id}: mission reward must be a number, got "${parts[1]}"`);
        base.requirements = splitList(parts[0]).join(";");
        base.rewards = `${parts[1].trim()}vp`;
      }
      base.passive = raw.passive || null;
      base.location_type = raw.location_type || null;
      break;

    case "items":
      base.equip = raw.equip || null;
      base.stored = raw.stored || null;
      // CSV column is `type`; stored as `itemType` on the card so it does not
      // collide with the card-type discriminant (`base.type`).
      base.itemType = splitList(raw.type || "");
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      break;

    case "events":
      base.timing = raw.timing;
      base.duration = intOrNull(raw.duration || "");
      base.trigger = raw.trigger || null;
      base.event_type = raw.event_type || null;
      if (raw.effect) base.effect = raw.effect;
      break;

    case "policies":
      base.effect = raw.effect;
      // Policy actions: the third colon-separated field is human-readable
      // prose for UI display (e.g. "Look at one opponent's hand."), not a
      // DSL string. The executable DSL is wired in
      // engine/src/listeners/effects.ts:POLICY_ACTIONS. Validation skips
      // DSL parsing for these — see the `validate` function.
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      break;
  }

  return base;
}

// --- Validation ---

type ValidationError = { card: string; field: string; message: string };

function validate(type: CardType, card: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = (card.id as string) || "unknown";

  if (!card.id) errors.push({ card: id, field: "id", message: "missing id" });
  if (!card.name) errors.push({ card: id, field: "name", message: "missing name" });
  if (!card.set) errors.push({ card: id, field: "set", message: "missing set" });
  if (!RARITIES.includes(card.rarity as any)) {
    errors.push({ card: id, field: "rarity", message: `invalid rarity: ${card.rarity}` });
  }

  if (type === "events" && !EVENT_TIMINGS.includes(card.timing as any)) {
    errors.push({ card: id, field: "timing", message: `invalid timing: ${card.timing}` });
  }

  // Cross-type attribute vocabulary — exact CamelCase membership in the
  // governed set (`engine/src/attributes.ts`). Closes the gap #158 left: the
  // old `keywords` column was unvalidated, so typos/un-migrated values could
  // silently no-op an effect. Case-sensitive on purpose so CSV data and the
  // hardcoded literals in effect factories cannot drift on spelling.
  const attributes = (card.attributes as string[] | undefined) ?? [];
  for (const attr of attributes) {
    if (!ATTRIBUTES.includes(attr as (typeof ATTRIBUTES)[number])) {
      errors.push({ card: id, field: "attributes", message: `invalid attribute: ${attr}` });
    }
  }

  // Per-type category enums.
  if (type === "locations" && card.location_type && !LOCATION_TYPES.includes(card.location_type as any)) {
    errors.push({ card: id, field: "location_type", message: `invalid location_type: ${card.location_type}` });
  }
  if (type === "events" && card.event_type && !EVENT_TYPES.includes(card.event_type as any)) {
    errors.push({ card: id, field: "event_type", message: `invalid event_type: ${card.event_type}` });
  }
  if (type === "items") {
    for (const t of (card.itemType as string[] | undefined) ?? []) {
      if (!ITEM_TYPES.includes(t as any)) {
        errors.push({ card: id, field: "type", message: `invalid item type: ${t}` });
      }
    }
  }

  // DSL effect validation — skipped for policies (action.effect is
  // human-readable prose; executable DSL lives in POLICY_ACTIONS).
  const actions = card.actions as { name: string; apCost: number; effect: string }[] | undefined;
  if (actions && type !== "policies") {
    for (const action of actions) {
      try {
        parseDSL(action.effect);
      } catch (e) {
        const msg = (e instanceof DSLParseError || e instanceof DSLValidationError) ? e.message : String(e);
        errors.push({ card: id, field: "actions", message: `invalid DSL in action "${action.name}": ${msg}` });
      }
    }
  }
  if (card.timing === "instant" && card.effect) {
    try {
      parseDSL(card.effect as string);
    } catch (e) {
      const msg = (e instanceof DSLParseError || e instanceof DSLValidationError) ? e.message : String(e);
      errors.push({ card: id, field: "effect", message: `invalid DSL: ${msg}` });
    }
  }

  return errors;
}

// --- Main ---

function buildSet(setName: string): { cards: Record<string, unknown>[]; errors: ValidationError[] } {
  const setDir = join(SETS_DIR, setName);
  const cards: Record<string, unknown>[] = [];
  const errors: ValidationError[] = [];

  for (const type of CARD_TYPES) {
    const csvPath = join(setDir, `${type}.csv`);
    if (!existsSync(csvPath)) {
      console.warn(`  Warning: ${type}.csv not found in ${setName}, skipping`);
      continue;
    }

    const raw = readFileSync(csvPath, "utf-8");
    const rows = parseCSV(raw);

    for (const row of rows) {
      const card = transformCard(type, row);
      errors.push(...validate(type, card));
      cards.push(card);
    }
  }

  return { cards, errors };
}

function main() {
  const targetSet = process.argv[2];
  mkdirSync(BUILD_DIR, { recursive: true });

  const sets = targetSet
    ? [targetSet]
    : readdirSync(SETS_DIR).filter((d) => {
        const p = join(SETS_DIR, d);
        return existsSync(p) && readdirSync(p).length > 0;
      });

  let allCards: Record<string, unknown>[] = [];
  let totalErrors: ValidationError[] = [];

  for (const setName of sets) {
    console.log(`Building set: ${setName}`);
    const { cards, errors } = buildSet(setName);

    writeFileSync(join(BUILD_DIR, `${setName}.json`), JSON.stringify(cards, null, 2));
    console.log(`  ${cards.length} cards`);

    allCards = allCards.concat(cards);
    totalErrors = totalErrors.concat(errors);
  }

  // Write merged output
  writeFileSync(join(BUILD_DIR, "all.json"), JSON.stringify(allCards, null, 2));

  // Report
  if (totalErrors.length > 0) {
    console.error(`\n${totalErrors.length} validation error(s):`);
    for (const e of totalErrors) {
      console.error(`  [${e.card}] ${e.field}: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`\nDone. ${allCards.length} cards total across ${sets.length} set(s).`);
}

main();
