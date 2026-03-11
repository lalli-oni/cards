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
import { join, basename } from "path";

const LIBRARY_DIR = join(import.meta.dir);
const SETS_DIR = join(LIBRARY_DIR, "sets");
const BUILD_DIR = join(LIBRARY_DIR, "build");

const CARD_TYPES = ["units", "locations", "items", "events", "policies"] as const;
type CardType = (typeof CARD_TYPES)[number];

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const EVENT_SUBTYPES = ["instant", "passive", "trap"] as const;

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
    type: type.replace(/s$/, ""), // units -> unit
    rarity: raw.rarity,
    cost: raw.cost.includes("|") ? raw.cost.split("|").map((c) => c.trim()) : raw.cost,
    text: raw.text || null,
    flavor: raw.flavor || null,
    keywords: splitList(raw.keywords || ""),
  };

  switch (type) {
    case "units":
      base.strength = intOrNull(raw.strength);
      base.cunning = intOrNull(raw.cunning);
      base.charisma = intOrNull(raw.charisma);
      base.attributes = splitList(raw.attributes || "");
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      break;

    case "locations":
      base.mission = raw.mission || null;
      base.passive = raw.passive || null;
      break;

    case "items":
      base.equip = raw.equip || null;
      base.stored = raw.stored || null;
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      break;

    case "events":
      base.subtype = raw.subtype;
      base.duration = intOrNull(raw.duration || "");
      base.trigger = raw.trigger || null;
      break;

    case "policies":
      base.effect = raw.effect;
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

  if (type === "events" && !EVENT_SUBTYPES.includes(card.subtype as any)) {
    errors.push({ card: id, field: "subtype", message: `invalid subtype: ${card.subtype}` });
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
    if (!existsSync(csvPath)) continue;

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
