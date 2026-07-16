// ---------------------------------------------------------------------------
// Governed mechanical keyword vocabulary
// ---------------------------------------------------------------------------
//
// Mechanical keywords are the reusable "what a card *does*" shorthands, carried
// in the `keywords` CSV column (renamed from `abilities` in #194). This module
// is the source of truth for the v0.1 keyword surface — the names, parameters,
// and which card types each keyword is legal on. `library/build.ts` parses every
// `keywords` token through `parseKeyword`, so an unknown name, malformed
// parameter, wrong arity, or wrong-type placement fails the build instead of
// shipping a silent no-op token. Keep in lockstep with the Keyword Glossary in
// `rules/README.md`.
//
// The vocabulary is deliberately self-contained — NOT merged with the action
// effect-DSL in `effect-dsl/`. Unifying keywords, actions, and passives under a
// single effect grammar is tracked post-v0.1 in #208.

export type CardKind = "unit" | "item" | "location" | "event" | "policy";
export type StatScope = "strength" | "cunning" | "charisma" | "all";
export type Stat = "strength" | "cunning" | "charisma";
export type Context = "combat" | "mission";
export type Role = "atk" | "def" | "either";

const STAT_SCOPES: readonly StatScope[] = ["strength", "cunning", "charisma", "all"];
const STATS: readonly Stat[] = ["strength", "cunning", "charisma"];
const CONTEXTS: readonly Context[] = ["combat", "mission"];
const ROLES: readonly Role[] = ["atk", "def", "either"];

/** A positional parameter a keyword token carries after its name. */
type ParamKind =
  | "signedMagnitude" // e.g. +2 / -1 — sign required
  | "magnitude" // positive integer
  | "statScope" // strength | cunning | charisma | all
  | "stat" // strength | cunning | charisma (no `all`)
  | "context" // combat | mission
  | "role"; // atk | def | either

interface ParamSpec {
  kind: ParamKind;
  /** Optional params may be omitted. Only trailing params should be optional. */
  optional?: boolean;
}

export interface KeywordSpec {
  name: string;
  /** Card types this keyword may legally appear on (per-type scoping). */
  cardKinds: readonly CardKind[];
  params: readonly ParamSpec[];
}

// The four modifier families share one parameter shape:
//   Name:±MAG:STAT-SCOPE:CONTEXT[:ROLE]   e.g. Prowess:+2:strength:combat:def
const FAMILY_PARAMS: readonly ParamSpec[] = [
  { kind: "signedMagnitude" },
  { kind: "statScope" },
  { kind: "context" },
  { kind: "role", optional: true },
];

/** The closed v0.1 keyword vocabulary. Source of truth; keep in sync with rules. */
export const KEYWORDS: readonly KeywordSpec[] = [
  // Modifier families (parameterized stat effects), by who they affect:
  { name: "Prowess", cardKinds: ["unit"], params: FAMILY_PARAMS }, // self
  { name: "Kindred", cardKinds: ["unit"], params: FAMILY_PARAMS }, // attribute-kin
  { name: "Leader", cardKinds: ["unit"], params: FAMILY_PARAMS }, // all friendly here
  { name: "Aura", cardKinds: ["location"], params: FAMILY_PARAMS }, // every unit here (friend + foe)

  // Standalone effect keywords:
  { name: "Untouchable", cardKinds: ["unit"], params: [{ kind: "stat" }] },
  { name: "Berserker", cardKinds: ["unit"], params: [] },
  { name: "Patron", cardKinds: ["unit"], params: [{ kind: "magnitude" }] },
  { name: "Loot", cardKinds: ["unit"], params: [] },
  { name: "Squire", cardKinds: ["unit"], params: [{ kind: "magnitude", optional: true }] },
  { name: "Flying", cardKinds: ["item"], params: [] },
  { name: "Heavy", cardKinds: ["item"], params: [] },
  { name: "Lightweight", cardKinds: ["item"], params: [] },
];

const KEYWORD_BY_NAME: ReadonlyMap<string, KeywordSpec> = new Map(
  KEYWORDS.map((k) => [k.name, k]),
);

/** Whether `name` is a governed keyword (exact CamelCase, like attributes). */
export function isKeyword(name: string): boolean {
  return KEYWORD_BY_NAME.has(name);
}

/** Structured result of parsing a keyword token. */
export interface ParsedKeyword {
  name: string;
  signedMagnitude?: number;
  magnitude?: number;
  statScope?: StatScope;
  stat?: Stat;
  context?: Context;
  role?: Role;
}

export class KeywordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeywordError";
  }
}

/**
 * Parse and validate a single `keywords`-column token (e.g. `Leader:+1:all:combat`)
 * against the governed vocabulary and the card type it appears on.
 *
 * Throws `KeywordError` on an unknown name, wrong-type placement, wrong arity, or
 * a malformed parameter. Case-sensitive on the keyword name and on enum params, so
 * CSV data and code cannot drift on spelling.
 */
export function parseKeyword(token: string, cardKind: CardKind): ParsedKeyword {
  const parts = token.split(":");
  const name = parts[0];
  const spec = KEYWORD_BY_NAME.get(name);
  if (!spec) throw new KeywordError(`unknown keyword: ${name}`);
  if (!spec.cardKinds.includes(cardKind)) {
    throw new KeywordError(
      `keyword ${name} is not valid on ${cardKind} cards (allowed: ${spec.cardKinds.join(", ")})`,
    );
  }

  const args = parts.slice(1);
  const required = spec.params.filter((p) => !p.optional).length;
  const max = spec.params.length;
  if (args.length < required || args.length > max) {
    const expected = required === max ? `${required}` : `${required}–${max}`;
    throw new KeywordError(
      `keyword ${name}: expected ${expected} parameter(s), got ${args.length}`,
    );
  }

  const result: ParsedKeyword = { name };
  spec.params.forEach((param, i) => {
    const raw = args[i];
    if (raw === undefined) return; // an omitted optional trailing param
    assignParam(name, param.kind, raw, result);
  });
  return result;
}

function assignParam(name: string, kind: ParamKind, raw: string, out: ParsedKeyword): void {
  switch (kind) {
    case "signedMagnitude":
      if (!/^[+-]\d+$/.test(raw)) {
        throw new KeywordError(
          `keyword ${name}: magnitude must be a signed integer (e.g. +2, -1), got "${raw}"`,
        );
      }
      out.signedMagnitude = parseInt(raw, 10);
      return;
    case "magnitude":
      if (!/^\d+$/.test(raw) || parseInt(raw, 10) < 1) {
        throw new KeywordError(`keyword ${name}: magnitude must be a positive integer, got "${raw}"`);
      }
      out.magnitude = parseInt(raw, 10);
      return;
    case "statScope":
      if (!STAT_SCOPES.includes(raw as StatScope)) {
        throw new KeywordError(`keyword ${name}: stat must be one of ${STAT_SCOPES.join(", ")}, got "${raw}"`);
      }
      out.statScope = raw as StatScope;
      return;
    case "stat":
      if (!STATS.includes(raw as Stat)) {
        throw new KeywordError(`keyword ${name}: stat must be one of ${STATS.join(", ")}, got "${raw}"`);
      }
      out.stat = raw as Stat;
      return;
    case "context":
      if (!CONTEXTS.includes(raw as Context)) {
        throw new KeywordError(`keyword ${name}: context must be one of ${CONTEXTS.join(", ")}, got "${raw}"`);
      }
      out.context = raw as Context;
      return;
    case "role":
      if (!ROLES.includes(raw as Role)) {
        throw new KeywordError(`keyword ${name}: role must be one of ${ROLES.join(", ")}, got "${raw}"`);
      }
      out.role = raw as Role;
      return;
  }
}
