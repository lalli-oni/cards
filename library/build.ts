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
import { KEYWORDS, KeywordError, parseKeyword } from "../engine/src/keywords";
import type { CardType as EngineCardType } from "../engine/src/types";
import {
  LOCATION_TYPES,
  EVENT_TYPES,
  ITEM_TYPES,
} from "../engine/src/card-categories";

const LIBRARY_DIR = join(import.meta.dir);
// `CARDS_SETS_DIR` / `CARDS_BUILD_DIR` override the input/output roots so a test
// can drive `main()` against a temp fixture without touching `library/`. Default
// to the real locations.
const SETS_DIR = process.env.CARDS_SETS_DIR ?? join(LIBRARY_DIR, "sets");
const BUILD_DIR = process.env.CARDS_BUILD_DIR ?? join(LIBRARY_DIR, "build");

const CARD_TYPES = ["units", "locations", "items", "events", "policies"] as const;
export type CardType = (typeof CARD_TYPES)[number];

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const EVENT_TIMINGS = ["instant", "passive", "trap"] as const;

// Governed per-type category vocabularies (`LOCATION_TYPES`/`EVENT_TYPES`/
// `ITEM_TYPES`) live in `engine/src/card-categories.ts` — the single source of
// truth shared with the engine types and effect factories. Validated here at
// build time like `rarity`/`timing`.

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

// A named passive ability: `name:effect`. Unlike an action there is no AP cost
// and `effect` is human-readable prose (not DSL), so we split on the first colon
// only and keep the rest verbatim. Drops (returns null) any nameless, effectless,
// or colon-less token — surfacing it as a structured `BuildWarning` (not a bare
// `console.warn`, per #213) since the build is the CSV validation gate and a
// silently-vanished passive is a data bug. The Python renderer's parse_card
// applies the same tolerance (name and effect both required) so build-time and
// render-time agree on which tokens are valid.
function parsePassive(
  raw: string,
  cardId: string,
  warnings: BuildWarning[],
): { name: string; effect: string } | null {
  const idx = raw.indexOf(":");
  const name = idx > 0 ? raw.slice(0, idx).trim() : "";
  const effect = idx > 0 ? raw.slice(idx + 1).trim() : "";
  if (!name || !effect) {
    warnings.push({
      card: cardId,
      field: "passives",
      message: `passive "${raw}" is not name:effect — skipping`,
      severity: "warning",
    });
    return null;
  }
  return { name, effect };
}

function intOrNull(value: string): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

// --- Card transformers ---

export function transformCard(
  type: CardType,
  raw: Record<string, string>,
  warnings: BuildWarning[] = [],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: raw.id,
    name: raw.name,
    set: raw.set,
    type: type === "policies" ? "policy" : type.replace(/s$/, ""), // units -> unit, policies -> policy
    rarity: raw.rarity,
    cost: raw.cost.includes("|") ? raw.cost.split("|").map((c) => c.trim()) : raw.cost,
    text: raw.text || null,
    flavor: raw.flavor || null,
    // Shared classification columns: `keywords` = mechanical keyword-effects
    // (things the card *does*), `attributes` = cross-type synergy vocabulary.
    // Both apply to every card type and are vocabulary-validated below against
    // their governed sets (`engine/src/keywords.ts`, `engine/src/attributes.ts`).
    keywords: splitList(raw.keywords || ""),
    attributes: splitList(raw.attributes || ""),
  };

  switch (type) {
    case "units":
      base.strength = intOrNull(raw.strength);
      base.cunning = intOrNull(raw.cunning);
      base.charisma = intOrNull(raw.charisma);
      base.actions = splitList(raw.actions || "").map(parseAction).filter(Boolean);
      base.passives = splitList(raw.passives || "").map((p) => parsePassive(p, raw.id, warnings)).filter(Boolean);
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
      // CSV column is `location_type`; stored as `locationType` on the card for
      // camelCase consistency with `itemType` and the engine field.
      base.locationType = raw.location_type || null;
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
      // CSV column is `event_type`; stored as `eventType` (camelCase) in-engine.
      base.eventType = raw.event_type || null;
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

// A build notice: a card/field-addressed message. The `severity` discriminant
// keeps the two channels non-interchangeable — a failing `ValidationError`
// cannot be silently routed into the non-failing `BuildWarning` list — while
// still letting one `printNotice` render both with the same line format.
type BuildNotice = {
  readonly card: string;
  readonly field: string;
  readonly message: string;
};

// Governance that *should* fail the build: unknown keyword/attribute, bad DSL,
// a missing/typo'd set, etc. Produced by `validate()` and `buildSet()`.
export type ValidationError = BuildNotice & { readonly severity: "error" };

// Non-failing notices that never affect the exit code — currently only a set
// legitimately omitting a per-type CSV (see `buildSet`). Returned via
// `buildSet().warnings` (not `console.warn`) so they land in the summary and are
// assertable via the return value. See #213.
export type BuildWarning = BuildNotice & { readonly severity: "warning" };

export function validate(
  type: CardType,
  card: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = (card.id as string) || "unknown";
  const err = (field: string, message: string): ValidationError => ({
    card: id,
    field,
    message,
    severity: "error",
  });

  if (!card.id) errors.push(err("id", "missing id"));
  if (!card.name) errors.push(err("name", "missing name"));
  if (!card.set) errors.push(err("set", "missing set"));
  if (!RARITIES.includes(card.rarity as any)) {
    errors.push(err("rarity", `invalid rarity: ${card.rarity}`));
  }

  // Cost is a required gold amount (or `|`-separated alternatives, stored as a
  // list post-transform). Each option must be a non-negative integer; a blank or
  // non-numeric cost would otherwise coerce to a null `gold-cost` downstream in
  // the analysis toolkit, silently masking the bad data instead of failing here.
  const costs = Array.isArray(card.cost) ? card.cost : [card.cost];
  for (const c of costs) {
    if (!/^\d+$/.test(String(c ?? "").trim())) {
      errors.push(err("cost", `invalid cost: ${JSON.stringify(card.cost)}`));
    }
  }

  if (type === "events" && !EVENT_TIMINGS.includes(card.timing as any)) {
    errors.push(err("timing", `invalid timing: ${card.timing}`));
  }

  // Cross-type attribute vocabulary — exact CamelCase membership in the governed
  // set (`engine/src/attributes.ts`). Case-sensitive on purpose so CSV data and
  // the hardcoded literals in effect factories cannot drift on spelling.
  const attributes = (card.attributes as string[] | undefined) ?? [];
  for (const attr of attributes) {
    if (!ATTRIBUTES.includes(attr as (typeof ATTRIBUTES)[number])) {
      errors.push(err("attributes", `invalid attribute: ${attr}`));
    }
  }

  // Governed keyword vocabulary (engine/src/keywords.ts). Each token in the
  // `keywords` column is parsed + validated: an unknown name, malformed
  // parameter, wrong arity, or an unsupported card type all fail the build,
  // mirroring the attribute gate above so keyword data and code can't drift.
  const keywords = (card.keywords as string[] | undefined) ?? [];
  for (const token of keywords) {
    try {
      parseKeyword(token, card.type as EngineCardType);
    } catch (e) {
      // Only a KeywordError is card-data (a bad token). Let anything else — an
      // engine fault in parseKeyword — propagate with its stack rather than
      // mislabel it as this card's validation error.
      if (!(e instanceof KeywordError)) throw e;
      errors.push(err("keywords", e.message));
    }
  }

  // Per-type category enums. Fields are stored camelCase post-transform
  // (`locationType`/`eventType`/`itemType`); the CSV columns they map from are
  // `location_type`/`event_type`/`type` (reflected in the error `field`).
  const locationType = card.locationType as (typeof LOCATION_TYPES)[number] | undefined;
  if (type === "locations" && locationType && !LOCATION_TYPES.includes(locationType)) {
    errors.push(err("location_type", `invalid location_type: ${locationType}`));
  }
  const eventType = card.eventType as (typeof EVENT_TYPES)[number] | undefined;
  if (type === "events" && eventType && !EVENT_TYPES.includes(eventType)) {
    errors.push(err("event_type", `invalid event_type: ${eventType}`));
  }
  if (type === "items") {
    for (const t of (card.itemType as string[] | undefined) ?? []) {
      if (!ITEM_TYPES.includes(t as (typeof ITEM_TYPES)[number])) {
        errors.push(err("type", `invalid item type: ${t}`));
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
        errors.push(err("actions", `invalid DSL in action "${action.name}": ${msg}`));
      }
    }
  }
  if (card.timing === "instant" && card.effect) {
    try {
      parseDSL(card.effect as string);
    } catch (e) {
      const msg = (e instanceof DSLParseError || e instanceof DSLValidationError) ? e.message : String(e);
      errors.push(err("effect", `invalid DSL: ${msg}`));
    }
  }

  return errors;
}

// --- Main ---

// Builds one set. Returns `warnings` alongside `errors`; unlike the old
// in-function `console.warn`, warnings are only visible if the caller surfaces
// them (see `main`'s summary) — a caller that ignores `.warnings` silently drops
// the notices, so callers are responsible for reporting them.
export function buildSet(setName: string, setsDir: string = SETS_DIR): {
  cards: Record<string, unknown>[];
  errors: ValidationError[];
  warnings: BuildWarning[];
} {
  const setDir: string = join(setsDir, setName);
  const cards: Record<string, unknown>[] = [];
  const errors: ValidationError[] = [];
  const warnings: BuildWarning[] = [];

  // A set whose directory is entirely absent is an operator error (a typo'd set
  // name), not a set legitimately omitting a card type — fail rather than emit
  // five "not found" warnings and a hollow exit-0 build.
  if (!existsSync(setDir)) {
    errors.push({ card: setName, field: "set", message: "set directory not found", severity: "error" });
    return { cards, errors, warnings };
  }

  for (const type of CARD_TYPES) {
    const csvPath = join(setDir, `${type}.csv`);
    if (!existsSync(csvPath)) {
      // Non-failing: a set may legitimately omit a card type.
      warnings.push({ card: setName, field: type, message: `${type}.csv not found, skipping`, severity: "warning" });
      continue;
    }

    const raw = readFileSync(csvPath, "utf-8");
    const rows = parseCSV(raw);

    for (const row of rows) {
      const card = transformCard(type, row, warnings);
      errors.push(...validate(type, card));
      cards.push(card);
    }
  }

  return { cards, errors, warnings };
}

// Render a notice list under a count header; shared by the warning and error
// summaries so both print with an identical `[card] field: message` line format
// (the whole point of the common `BuildNotice` base).
function printNotices(
  notices: BuildNotice[],
  header: string,
  stream: (message: string) => void,
): void {
  if (notices.length === 0) return;
  stream(`\n${notices.length} ${header}:`);
  for (const n of notices) {
    stream(`  [${n.card}] ${n.field}: ${n.message}`);
  }
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
  let totalWarnings: BuildWarning[] = [];

  for (const setName of sets) {
    console.log(`Building set: ${setName}`);
    const { cards, errors, warnings } = buildSet(setName);

    writeFileSync(join(BUILD_DIR, `${setName}.json`), JSON.stringify(cards, null, 2));
    console.log(`  ${cards.length} cards`);

    allCards = allCards.concat(cards);
    totalErrors = totalErrors.concat(errors);
    totalWarnings = totalWarnings.concat(warnings);
  }

  // Write merged output
  writeFileSync(join(BUILD_DIR, "all.json"), JSON.stringify(allCards, null, 2));

  // Emit the governed keyword vocabulary so tooling (keyword-coverage) and the
  // card renderer can consume it without duplicating the source of truth
  // (engine/src/keywords.ts). `params` + `reminder` let the renderer compose
  // card-facing reminder prose from a token's values; coverage reads only
  // `name`/`cardTypes` and ignores the rest.
  writeFileSync(
    join(BUILD_DIR, "keywords.json"),
    JSON.stringify(
      KEYWORDS.map((k) => ({
        name: k.name,
        cardTypes: k.cardTypes,
        params: k.params.map((p) => ({
          name: p.name,
          kind: p.kind,
          ...(p.optional ? { optional: true } : {}),
          ...(p.default !== undefined ? { default: p.default } : {}),
        })),
        reminder: k.reminder,
      })),
      null,
      2,
    ),
  );

  // Report — warnings first (non-failing), then errors (which fail the build).
  printNotices(totalWarnings, "warning(s)", (m) => console.warn(m));
  printNotices(totalErrors, "validation error(s)", (m) => console.error(m));
  if (totalErrors.length > 0) process.exit(1);

  console.log(`\nDone. ${allCards.length} cards total across ${sets.length} set(s).`);
}

// Only run the build when invoked directly (`bun library/build.ts`), not when
// imported by tests (`library/build.test.ts` pulls in `validate`/`transformCard`).
if (import.meta.main) {
  main();
}
