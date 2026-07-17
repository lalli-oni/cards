/**
 * Keyword glossary — the machine-readable render↔data contract (#203).
 *
 * `rules/README.md` stays the human-authored source of truth. This module
 * derives a structured glossary from its "## Keyword System" tables so the
 * build, the Penpot renderer (`design/compose-cards.py`), and eventually the
 * engine all read one artifact instead of re-parsing prose. The build writes
 * the derived form to `library/build/glossary.json`.
 *
 * Keyword value syntax (decided in #203): a card's `abilities` field is a
 * `;`-separated list of tokens shaped like the effect-DSL `token` rule —
 * `ident value?` where a value is `[N]` (e.g. `Commander[3];Lethal`). Values
 * are magnitudes; the sign lives in the reminder text ("get -X").
 */

export type KeywordScope = "unit" | "equipment" | "location";
export type KeywordTiming = "static" | "triggered" | "activated";

export interface KeywordDef {
  /** Lowercased lookup id (e.g. `commander`). */
  id: string;
  /** Title-case display name matching the glossary (e.g. `Commander`). */
  name: string;
  scope: KeywordScope;
  timing: KeywordTiming;
  /** AP cost for Activated keywords (e.g. Heal → 1), when the glossary states one. */
  apCost?: number;
  /** Whether the keyword carries a value — inferred from an `X` in the definition. */
  valued: boolean;
  /**
   * Reminder-text template. Keeps the glossary's `X` placeholder; consumers
   * substitute the card's value (value-less keywords have no `X`).
   */
  reminder: string;
}

export type Glossary = Record<string, KeywordDef>;

const SCOPE_HEADINGS: Record<string, KeywordScope> = {
  "unit keywords": "unit",
  "equipment keywords": "equipment",
  "location keywords": "location",
};

const VALID_TIMINGS: KeywordTiming[] = ["static", "triggered", "activated"];

/** A standalone `X` placeholder (matches `+X`, `-X`, `X` — not words like `max`). */
const VALUE_PLACEHOLDER = /\bX\b/;

/**
 * Parse the keyword glossary out of `rules/README.md`.
 *
 * Scoped to the `## Keyword System` section (up to the next top-level `## `),
 * reading the `#### Unit/Equipment/Location keywords` markdown tables. Throws
 * if the section or its tables can't be found, so a rules refactor fails the
 * build loudly instead of silently emitting an empty contract.
 */
export function parseGlossary(readmeContent: string): Glossary {
  const start = readmeContent.indexOf("## Keyword System");
  if (start === -1) {
    throw new Error("glossary: '## Keyword System' section not found in rules/README.md");
  }
  // End at the next top-level heading after the section start.
  const rest = readmeContent.slice(start + "## Keyword System".length);
  const nextTop = rest.search(/\n## /);
  const section = nextTop === -1 ? rest : rest.slice(0, nextTop);

  const glossary: Glossary = {};
  let scope: KeywordScope | null = null;

  for (const line of section.split("\n")) {
    const heading = line.match(/^####\s+(.+?)\s*$/);
    if (heading) {
      scope = SCOPE_HEADINGS[heading[1].trim().toLowerCase()] ?? null;
      continue;
    }

    if (!scope || !line.trimStart().startsWith("|")) continue;

    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const [keyword, timingCell, definition] = cells;
    // Skip the header row and the `|---|` separator.
    if (keyword.toLowerCase() === "keyword" || /^-+$/.test(keyword)) continue;

    const timingWord = (timingCell.match(/^([A-Za-z]+)/)?.[1] ?? "").toLowerCase() as KeywordTiming;
    if (!VALID_TIMINGS.includes(timingWord)) {
      throw new Error(`glossary: '${keyword}' has unrecognized timing "${timingCell}"`);
    }
    const apCost = timingCell.match(/\((\d+)\s*AP\)/i)?.[1];

    const def: KeywordDef = {
      id: keyword.toLowerCase(),
      name: keyword,
      scope,
      timing: timingWord,
      valued: VALUE_PLACEHOLDER.test(definition),
      reminder: definition,
    };
    if (apCost !== undefined) def.apCost = parseInt(apCost, 10);
    glossary[def.id] = def;
  }

  if (Object.keys(glossary).length === 0) {
    throw new Error("glossary: no keywords parsed from the '## Keyword System' tables");
  }
  return glossary;
}

export interface AbilityToken {
  /** Lowercased glossary lookup id. */
  id: string;
  /** As-written keyword name. */
  name: string;
  /** Parsed value, or null for a value-less keyword. */
  value: number | null;
}

/** `ident value?` where value is `[N]` — e.g. `Commander[3]` or `Lethal`. */
const ABILITY_TOKEN = /^([A-Za-z][A-Za-z-]*)(?:\[(\d+)\])?$/;

/**
 * Parse a single `abilities` token (`Commander[3]` / `Lethal`). Returns null
 * if malformed — the caller decides whether that's an error.
 */
export function parseAbilityToken(raw: string): AbilityToken | null {
  const m = raw.trim().match(ABILITY_TOKEN);
  if (!m) return null;
  return {
    id: m[1].toLowerCase(),
    name: m[1],
    value: m[2] !== undefined ? parseInt(m[2], 10) : null,
  };
}
