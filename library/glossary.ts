/**
 * Keyword glossary — the machine-readable render↔data contract (#203).
 *
 * `rules/README.md` stays the human-authored source of truth. This module
 * derives a structured glossary from its "## Keyword System" tables and the
 * build writes it to `library/build/glossary.json`. Today only the build reads
 * that artifact; the Penpot renderer (`design/moderntrek-template.py`) and,
 * eventually, the engine are intended to migrate onto it instead of each
 * re-parsing the prose (they still re-parse it for now).
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

/** Keyed by `KeywordDef.id` (the lowercased keyword) — the key and the entry's
 *  `id` are always the same string, and `parseGlossary` is the only sanctioned
 *  way to build one so that invariant (and the lowercasing) holds. */
export type Glossary = Record<string, KeywordDef>;

const SCOPE_HEADINGS: Record<string, KeywordScope> = {
  "unit keywords": "unit",
  "equipment keywords": "equipment",
  "location keywords": "location",
};

const VALID_TIMINGS: KeywordTiming[] = ["static", "triggered", "activated"];
const VALID_SCOPES: KeywordScope[] = ["unit", "equipment", "location"];

/**
 * A standalone uppercase `X` placeholder — matches `+X`, `-X`, and a bare `X`,
 * but not an `X` embedded in a word (e.g. `MAX`, `EXIT`). A lowercase `x` (as in
 * `max`) is excluded by case, since the pattern is case-sensitive.
 */
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
  // Anchor on the heading as a whole line so a stray inline mention of the
  // phrase (or a longer heading like `## Keyword Systems`) can't re-anchor us.
  const start = readmeContent.search(/^## Keyword System\s*$/m);
  if (start === -1) {
    throw new Error("glossary: '## Keyword System' section not found in rules/README.md");
  }
  // End at the next top-level heading after the section start.
  const rest = readmeContent.slice(start + "## Keyword System".length);
  const nextTop = rest.search(/\n## /);
  const section = nextTop === -1 ? rest : rest.slice(0, nextTop);

  const glossary: Glossary = {};
  const scopesSeen: Set<KeywordScope> = new Set();
  let scope: KeywordScope | null = null;

  for (const line of section.split("\n")) {
    const heading: RegExpMatchArray | null = line.match(/^####\s+(.+?)\s*$/);
    if (heading) {
      scope = SCOPE_HEADINGS[heading[1].trim().toLowerCase()] ?? null;
      continue;
    }

    if (!scope || !line.trimStart().startsWith("|")) continue;

    // Strip the (optional) outer pipes, then split on unescaped `|`. This keeps
    // a row that omits its trailing pipe, or embeds an escaped `\|` in the
    // definition, from being silently truncated or dropped (#203 render↔data drift).
    const inner: string = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = inner.split(/(?<!\\)\|/).map((c: string) => c.trim().replace(/\\\|/g, "|"));
    const [keyword, timingCell, definition] = cells;

    // Skip the header row and any alignment separator (`---`, `:--:`, `--:`).
    if (
      keyword.toLowerCase() === "keyword" ||
      timingCell?.toLowerCase() === "timing" ||
      /^:?-+:?$/.test(keyword)
    ) {
      continue;
    }

    // A real data row has all three columns. A content-bearing short row is
    // malformed (throw, don't silently skip); a fully-empty one is ignorable.
    if (cells.length < 3) {
      if (cells.some((c: string) => c !== "")) {
        throw new Error(`glossary: malformed table row "${line.trim()}" (expected 3 columns: Keyword | Timing | Definition)`);
      }
      continue;
    }

    const timingWord: KeywordTiming = (timingCell.match(/^([A-Za-z]+)/)?.[1] ?? "").toLowerCase() as KeywordTiming;
    if (!VALID_TIMINGS.includes(timingWord)) {
      throw new Error(`glossary: '${keyword}' has unrecognized timing "${timingCell}"`);
    }
    const apCost: string | undefined = timingCell.match(/\((\d+)\s*AP\)/i)?.[1];
    // AP cost and Activated timing must agree — catches a `Static (2 AP)` typo,
    // or an Activated row that forgot its `(N AP)`.
    if (apCost !== undefined && timingWord !== "activated") {
      throw new Error(`glossary: '${keyword}' has an AP cost but timing "${timingWord}" (only Activated keywords take AP)`);
    }
    if (timingWord === "activated" && apCost === undefined) {
      throw new Error(`glossary: Activated keyword '${keyword}' is missing its "(N AP)" cost`);
    }

    const id: string = keyword.toLowerCase();
    if (glossary[id]) {
      throw new Error(`glossary: duplicate keyword '${keyword}'`);
    }
    const def: KeywordDef = {
      id,
      name: keyword,
      scope,
      timing: timingWord,
      // `valued` caches "does `reminder` contain the X placeholder" so consumers
      // needn't re-run the regex; it must stay in sync with `reminder`.
      valued: VALUE_PLACEHOLDER.test(definition),
      reminder: definition,
    };
    if (apCost !== undefined) def.apCost = parseInt(apCost, 10);
    glossary[id] = def;
    scopesSeen.add(scope);
  }

  if (Object.keys(glossary).length === 0) {
    throw new Error("glossary: no keywords parsed from the '## Keyword System' tables");
  }
  // A renamed/typo'd `#### ... keywords` heading silently drops a whole scope
  // while leaving the glossary non-empty, so the empty-guard above wouldn't fire.
  // Require every scope to have contributed at least one keyword.
  for (const s of VALID_SCOPES) {
    if (!scopesSeen.has(s)) {
      throw new Error(`glossary: no '${s}' keywords parsed — a '#### ... keywords' heading was renamed or its table is malformed`);
    }
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
