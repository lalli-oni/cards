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
  // Placeholder name referenced by a keyword's `reminder` template (e.g. a
  // template `"...get {magnitude} to {stat}..."` binds to the params named
  // `magnitude` and `stat`). Also emitted into build/keywords.json so the
  // renderer can map a token's positional args onto these names.
  name: string;
  kind: ParamKind;
  // Optional params may be omitted. Only trailing params should be optional.
  optional?: boolean;
  // Value the reminder renderer substitutes when an optional param is omitted
  // (e.g. `Squire` with no arg reads as "…cost 1 less AP"). Display-only — the
  // engine does not apply it in `parseKeyword`. Only meaningful on an `optional`
  // numeric (`magnitude`/`signedMagnitude`) param; the type does not currently
  // enforce that pairing, so keep new keywords honest. Optional enum params
  // (e.g. the family `role`) intentionally carry no `default` — the renderer
  // collapses the omitted clause via whitespace rather than substituting a value.
  default?: number;
}

export interface KeywordSpec {
  name: string;
  // Card types the engine supports this keyword on.
  cardTypes: readonly CardType[];
  params: readonly ParamSpec[];
  // Card-facing reminder text, with `{paramName}` placeholders bound to `params`
  // (see ParamSpec.name). The renderer composes prose by substituting the
  // token's parsed values; this is the source of truth for that prose, kept in
  // sync with the rules Keyword Glossary. Formatting of param values (e.g. the
  // `all` scope → "all stats", `mission` context → "on missions") is a
  // presentation concern the renderer applies. The placeholder↔param-name
  // binding is stringly-typed here; it is enforced at build time by
  // `test/build.test.ts` (every `{placeholder}` must resolve to a declared
  // param), not by the TypeScript type.
  reminder: string;
}

// The four modifier families share one parameter shape:
//   Name:±MAG:STAT-SCOPE:CONTEXT[:ROLE]   e.g. Prowess:+2:strength:combat:def
const FAMILY_PARAMS: readonly ParamSpec[] = [
  { name: "magnitude", kind: "signedMagnitude" },
  { name: "stat", kind: "statScope" },
  { name: "context", kind: "context" },
  { name: "role", kind: "role", optional: true },
];

// The closed keyword vocabulary. Source of truth; keep in sync with the rules
// Keyword Glossary.
export const KEYWORDS: readonly KeywordSpec[] = [
  // Modifier families (parameterized stat effects), by who they affect. They
  // share FAMILY_PARAMS and differ only in the scope clause of their reminder:
  { name: "Prowess", cardTypes: ["unit"], params: FAMILY_PARAMS, // self
    reminder: "This unit gets {magnitude} to {stat} {context}{role}." },
  { name: "Kindred", cardTypes: ["unit"], params: FAMILY_PARAMS, // attribute-kin
    reminder: "Friendly units sharing an attribute with this unit get {magnitude} to {stat} {context}{role}." },
  { name: "Leader", cardTypes: ["unit"], params: FAMILY_PARAMS, // all friendly here
    reminder: "Friendly units at this location get {magnitude} to {stat} {context}{role}." },
  { name: "Aura", cardTypes: ["location"], params: FAMILY_PARAMS, // every unit here (friend + foe)
    reminder: "Every unit at this location — friend or foe — gets {magnitude} to {stat} {context}{role}." },

  // Standalone effect keywords:
  { name: "Untouchable", cardTypes: ["unit"], params: [{ name: "stat", kind: "stat" }],
    reminder: "Cannot be targeted by an Attack while this unit's {stat} exceeds the attacker's {stat}." },
  { name: "Berserker", cardTypes: ["unit"], params: [],
    reminder: "When this unit wins combat and would injure the loser, it injures itself and kills the loser instead." },
  { name: "Patron", cardTypes: ["unit"], params: [{ name: "amount", kind: "magnitude" }],
    reminder: "Cards you buy that share an attribute with this unit cost {amount} less gold." },
  { name: "Loot", cardTypes: ["unit"], params: [],
    reminder: "When this unit kills an enemy in combat, draw a card." },
  { name: "Squire", cardTypes: ["unit"], params: [{ name: "amount", kind: "magnitude", optional: true, default: 1 }],
    reminder: "Your Equip and Unequip actions cost {amount} less AP." },
  { name: "Flying", cardTypes: ["item"], params: [],
    reminder: "While equipped, this unit ignores blocked edges when moving." },
  { name: "Heavy", cardTypes: ["item"], params: [],
    reminder: "The equipped unit's Move action costs +1 AP." },
  { name: "Lightweight", cardTypes: ["item"], params: [],
    reminder: "The equipped unit's Move action costs 1 less AP." },
];

const KEYWORD_BY_NAME: ReadonlyMap<string, KeywordSpec> = new Map(
  KEYWORDS.map((k) => [k.name, k]),
);

// Whether `name` is a governed keyword (exact CamelCase, like attributes).
export function isKeyword(name: string): boolean {
  return KEYWORD_BY_NAME.has(name);
}

// Structured result of parsing a keyword token. NB: this keys parsed values by
// param *kind* (`signedMagnitude`, `magnitude`, `statScope`, …), whereas
// `ParamSpec.name` uses semantic names (`amount`, `magnitude`, `stat`, …) that
// the renderer binds against. The two namings are intentionally separate — the
// engine reads `ParsedKeyword`, the renderer reads `build/keywords.json` by
// name/kind — but they describe the same params and must be kept consistent.
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
