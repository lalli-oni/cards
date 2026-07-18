// Governed mechanical keyword vocabulary — the source of truth for what keywords
// exist, how their tokens parse, and which card types the engine supports each
// on. A keyword is a reusable "what a card does" shorthand carried in the
// `keywords` column; `parseKeyword` validates a token against that grammar and
// support map, so an unknown name, malformed parameter, wrong arity, or a
// keyword used on an unsupported card type all fail the build.
//
// This is the engine-side mechanic definition. Card-SET composition rules
// (e.g. coverage minimums) are design-side and live in the library, not here.

import { type CardType, type Stat, STAT_NAMES } from "./types";

export type StatScope = Stat | "all";
export type Context = "combat" | "mission";
export type Role = "atk" | "def" | "either";

const STAT_SCOPES = [...STAT_NAMES, "all"] as const;
const CONTEXTS = ["combat", "mission"] as const;
const ROLES = ["atk", "def", "either"] as const;

// A positional parameter a keyword token carries after its name.
type ParamKind =
  | "signedMagnitude" // e.g. +2 / -1 — sign required
  | "magnitude" // positive integer
  | "statScope" // a stat, or `all`
  | "stat" // a stat (no `all`)
  | "context" // combat | mission
  | "role"; // atk | def | either

interface ParamSpec {
  kind: ParamKind;
  // Optional params may be omitted. Only trailing params should be optional.
  optional?: boolean;
}

export interface KeywordSpec {
  name: string;
  // Card types the engine supports this keyword on.
  cardTypes: readonly CardType[];
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

// The closed keyword vocabulary. Source of truth; keep in sync with the rules
// Keyword Glossary.
export const KEYWORDS: readonly KeywordSpec[] = [
  // Modifier families (parameterized stat effects), by who they affect:
  { name: "Prowess", cardTypes: ["unit"], params: FAMILY_PARAMS }, // self
  { name: "Kindred", cardTypes: ["unit"], params: FAMILY_PARAMS }, // attribute-kin
  { name: "Leader", cardTypes: ["unit"], params: FAMILY_PARAMS }, // all friendly here
  { name: "Aura", cardTypes: ["location"], params: FAMILY_PARAMS }, // every unit here (friend + foe)

  // Standalone effect keywords:
  { name: "Untouchable", cardTypes: ["unit"], params: [{ kind: "stat" }] },
  { name: "Berserker", cardTypes: ["unit"], params: [] },
  { name: "Patron", cardTypes: ["unit"], params: [{ kind: "magnitude" }] },
  { name: "Loot", cardTypes: ["unit"], params: [] },
  { name: "Squire", cardTypes: ["unit"], params: [{ kind: "magnitude", optional: true }] },
  { name: "Flying", cardTypes: ["item"], params: [] },
  { name: "Heavy", cardTypes: ["item"], params: [] },
  { name: "Lightweight", cardTypes: ["item"], params: [] },
];

const KEYWORD_BY_NAME: ReadonlyMap<string, KeywordSpec> = new Map(
  KEYWORDS.map((k) => [k.name, k]),
);

// Whether `name` is a governed keyword (exact CamelCase, like attributes).
export function isKeyword(name: string): boolean {
  return KEYWORD_BY_NAME.has(name);
}

// Structured result of parsing a keyword token.
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

// Parse and validate a single `keywords`-column token (e.g. `Leader:+1:all:combat`)
// against the keyword grammar and the card type it appears on. Throws
// `KeywordError` on an unknown name, an unsupported card type, wrong arity, or a
// malformed parameter. Case-sensitive on the name and enum params so card data
// and code cannot drift on spelling.
export function parseKeyword(token: string, cardType: CardType): ParsedKeyword {
  const parts = token.split(":");
  const name = parts[0];
  const spec = KEYWORD_BY_NAME.get(name);
  if (!spec) throw new KeywordError(`unknown keyword: ${name}`);
  if (!spec.cardTypes.includes(cardType)) {
    throw new KeywordError(
      `keyword ${name} is not supported on ${cardType} cards (supported: ${spec.cardTypes.join(", ")})`,
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
      if (!STAT_NAMES.includes(raw as Stat)) {
        throw new KeywordError(`keyword ${name}: stat must be one of ${STAT_NAMES.join(", ")}, got "${raw}"`);
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
