import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSet,
  transformCard,
  validate,
  type BuildWarning,
  type CardType,
} from "../library/build";
import { KEYWORD_SPECS, KeywordError, type KeywordSpec, parseKeyword } from "../engine/src/keywords";
import { DIRECT_HOOK_KEYWORDS, keywordEffects, type KeywordCard } from "../engine/src/keyword-effects";
import type { CardType as EngineCardType, ItemCard } from "../engine/src/types";

// ---------------------------------------------------------------------------
// Build-time governed-vocabulary validation (#119)
//
// The headline feature of the `keywords` split is that build.ts rejects
// out-of-vocab values in the governed columns (`attributes`, `location_type`,
// `event_type`, item `type`) — the same way it already rejects a bad `rarity`
// or `timing`. These tests drive `validate()` directly (via `transformCard`,
// the same path `buildSet` uses) so a deleted or inverted membership check
// fails here instead of silently shipping bad data.
// ---------------------------------------------------------------------------

/** Build a raw CSV row with sensible defaults, overridable per-field. */
function row(overrides: Record<string, string>): Record<string, string> {
  return {
    id: "test-card",
    name: "Test Card",
    set: "test-set",
    rarity: "common",
    cost: "3",
    text: "",
    flavor: "",
    keywords: "",
    attributes: "",
    ...overrides,
  };
}

/** transformCard + validate in one step, returning the validation errors. */
function check(type: CardType, overrides: Record<string, string>) {
  return validate(type, transformCard(type, row(overrides)));
}

describe("build validation — governed vocabularies", () => {
  test("accepts a card with only governed values", () => {
    expect(check("locations", { attributes: "Commerce", location_type: "Market" })).toEqual([]);
    expect(check("events", { timing: "instant", event_type: "Catastrophe" })).toEqual([]);
    expect(check("items", { type: "Artifact" })).toEqual([]);
    expect(check("units", { attributes: "Military" })).toEqual([]);
  });

  test("rejects an un-governed attribute", () => {
    const errors = check("units", { attributes: "Millitary" });
    expect(errors.some((e) => e.field === "attributes" && e.message.includes("Millitary"))).toBe(true);
  });

  test("rejects an un-governed location_type", () => {
    const errors = check("locations", { location_type: "Bazaar" });
    expect(errors.some((e) => e.field === "location_type" && e.message.includes("Bazaar"))).toBe(true);
  });

  test("rejects an un-governed event_type", () => {
    const errors = check("events", { timing: "instant", event_type: "Blessing" });
    expect(errors.some((e) => e.field === "event_type" && e.message.includes("Blessing"))).toBe(true);
  });

  test("rejects an un-governed item type", () => {
    // "Accessory" is intentionally not in the governed set (pending #45).
    const errors = check("items", { type: "Accessory" });
    expect(errors.some((e) => e.field === "type" && e.message.includes("Accessory"))).toBe(true);
  });

  test("validation is case-sensitive on attributes (canonical CamelCase gate)", () => {
    const errors = check("units", { attributes: "military" });
    expect(errors.some((e) => e.field === "attributes")).toBe(true);
  });

  test("attributes are validated on every card type, not just units", () => {
    // #119 folded thematic keywords into `attributes` across all types.
    expect(check("policies", { attributes: "Nonsense" }).some((e) => e.field === "attributes")).toBe(true);
    expect(check("events", { timing: "instant", attributes: "Nonsense" }).some((e) => e.field === "attributes")).toBe(true);
  });
});

describe("build validation — governed keywords", () => {
  test("accepts governed keyword tokens on the right card type", () => {
    expect(check("units", { attributes: "Military", keywords: "Berserker;Leader:+1:all:contest" })).toEqual([]);
    expect(check("items", { type: "Banner", keywords: "Flying" })).toEqual([]);
    expect(check("locations", { location_type: "Market", keywords: "Aura:-1:all:contest" })).toEqual([]);
  });

  test("rejects an unknown keyword", () => {
    const errors = check("units", { attributes: "Military", keywords: "Lethal" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("unknown keyword"))).toBe(true);
  });

  test("rejects a malformed family token (unsigned magnitude)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Leader:1:all:contest" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("magnitude"))).toBe(true);
  });

  test("rejects an unsupported card type (Aura on a unit)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Aura:-1:all:contest" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("not supported on unit"))).toBe(true);
  });

  test("build/keywords.json emits the {name, cardTypes, params, reminder} shape the renderer reads", () => {
    // Pins the producer half of the render↔data contract: the Python renderer's
    // load_keyword_vocab expects a JSON array of {name, cardTypes, params,
    // reminder}, and compose_reminder binds a token's positional args to each
    // param `name`/`kind` before substituting into `reminder`. A rename or
    // reshape in build.ts's emit would break it silently — caught here. (Requires
    // a prior `bun library/build.ts`, which the `test` script runs first.)
    const artifact = JSON.parse(readFileSync(join(import.meta.dir, "../library/build/keywords.json"), "utf-8"));
    expect(Array.isArray(artifact)).toBe(true);
    expect(artifact.length).toBe(KEYWORD_SPECS.length);
    for (const entry of artifact) {
      expect(Object.keys(entry).sort()).toEqual(["cardTypes", "name", "params", "reminder"]);
      expect(typeof entry.name).toBe("string");
      expect(Array.isArray(entry.cardTypes)).toBe(true);
      expect(typeof entry.reminder).toBe("string");
      expect(Array.isArray(entry.params)).toBe(true);
      for (const p of entry.params) {
        expect(typeof p.name).toBe("string");
        expect(typeof p.kind).toBe("string");
      }
      // Every {paramName} placeholder in the template must bind to a declared param.
      const declared = new Set(entry.params.map((p: { name: string }) => p.name));
      for (const ph of entry.reminder.matchAll(/\{(\w+)\}/g)) {
        expect(declared.has(ph[1])).toBe(true);
      }
    }
  });

  test("emits optional/default for params that declare them (Squire's default is load-bearing)", () => {
    // The Python renderer's compose_reminder substitutes `default` when the
    // optional arg is omitted — drop/rename the emission and Squire renders
    // "…cost  less AP". The shape test above only checks name/kind, so pin the
    // optional/default emission explicitly here.
    const artifact = JSON.parse(readFileSync(join(import.meta.dir, "../library/build/keywords.json"), "utf-8"));
    const paramOf = (kw: string, param: string) =>
      artifact.find((k: { name: string }) => k.name === kw)
        ?.params.find((p: { name: string }) => p.name === param);
    expect(paramOf("Squire", "amount")).toMatchObject({ optional: true, default: 1 });
    // A required magnitude param (Patron) carries neither flag.
    const patron = paramOf("Patron", "amount");
    expect(patron.optional).toBeUndefined();
    expect(patron.default).toBeUndefined();
  });

  test("keyword names and each keyword's param names are unique", () => {
    // Duplicate keyword names silently collapse in KEYWORD_BY_NAME (last wins);
    // duplicate param names within a keyword make placeholder binding ambiguous.
    const names = KEYWORD_SPECS.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
    for (const k of KEYWORD_SPECS) {
      const paramNames = k.params.map((p) => p.name);
      expect(new Set(paramNames).size).toBe(paramNames.length);
    }
  });

  test("a param's `default` appears only on an optional numeric param", () => {
    // `default` is the display-only fallback the renderer substitutes for an
    // omitted optional arg — meaningful only on an optional magnitude/
    // signedMagnitude param. ParamSpec doesn't encode that pairing in the type
    // ("keep new keywords honest"), so enforce the invariant here instead.
    for (const k of KEYWORD_SPECS) {
      for (const p of k.params) {
        if (p.default !== undefined) {
          expect(p.optional).toBe(true);
          expect(["magnitude", "signedMagnitude"]).toContain(p.kind);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Keyword runtime exhaustiveness
//
// A vocabulary entry with no keyword-effects.ts case is a card that reads as
// doing something and does nothing. Pin that
// every governed keyword is either resolved by keywordEffects's switch or is
// a documented direct hook (Berserker/Loot/Untouchable/Flying), so adding a
// keyword to the vocabulary without wiring its runtime semantics fails loud here
// instead of shipping an inert card.
// ---------------------------------------------------------------------------

function minimalCard(type: EngineCardType): KeywordCard {
  const base = {
    id: "t1", definitionId: "t", name: "T", cost: "1",
    rarity: "common" as const, ownerId: "p1", controllerId: "p1",
  };
  if (type === "unit") {
    return { ...base, type: "unit", strength: 1, cunning: 1, charisma: 1, attributes: [], injured: false };
  }
  if (type === "location") {
    return { ...base, type: "location", edges: { n: true, e: true, s: true, w: true } };
  }
  if (type === "item") {
    return { ...base, type: "item" };
  }
  // A keyword declared on `event`/`policy` has no card shape to build here.
  // Surfaced as an assertion rather than a thrown Error so the failure names
  // the gap instead of aborting the suite with a stack trace.
  expect(`unsupported card type for keyword exhaustiveness: ${type}`).toBe("");
  throw new Error("unreachable");
}

/** Builds a minimally-valid token for `spec` from its grammar alone (skipping
 *  optional params), so this stays accurate as the grammar evolves rather
 *  than hardcoding a token string per keyword name. */
function minimalToken(spec: KeywordSpec): string {
  const parts = [spec.name];
  for (const param of spec.params) {
    if (param.optional) continue;
    switch (param.kind) {
      case "signedMagnitude": parts.push("+1"); break;
      case "magnitude": parts.push("1"); break;
      case "statScope": parts.push("strength"); break;
      case "stat": parts.push("strength"); break;
      case "context": parts.push("contest"); break;
      case "role": parts.push("either"); break;
    }
  }
  return parts.join(":");
}

describe("keyword runtime exhaustiveness", () => {
  test("every governed keyword is resolved by keywordEffects or is a documented direct hook", () => {
    const unhandled: string[] = [];
    for (const spec of KEYWORD_SPECS) {
      if ((DIRECT_HOOK_KEYWORDS as readonly string[]).includes(spec.name)) continue;
      // Every supported card type, not just the first: a keyword allowed on
      // two types with a resolver for only one would otherwise pass.
      for (const cardType of spec.cardTypes) {
        const card = minimalCard(cardType);
        card.keywords = [minimalToken(spec)];
        // keywordEffects overloads on card type (item vs. unit/location) so a
        // real caller can't pass undefined for a unit's controllerId. This
        // exhaustiveness sweep genuinely needs to call across the whole
        // KeywordCard union at runtime, which the overloads don't model — the
        // cast picks the more permissive (item) overload; "p1" satisfies
        // either since it's always defined.
        const result = keywordEffects(card as ItemCard, "p1", { row: 0, col: 0 });
        if (result.listeners.length === 0 && result.queries.length === 0) {
          unhandled.push(`${spec.name} (${cardType})`);
        }
      }
    }
    expect(unhandled).toEqual([]);
  });

  // Frozen rather than merely validated. The exhaustiveness test above skips
  // anything in this list, so a contributor could otherwise silence it by
  // adding a name here and never writing the hook — shipping exactly the inert
  // keyword the check exists to prevent. Growing the list now requires editing
  // this assertion, which a reviewer sees.
  test("DIRECT_HOOK_KEYWORDS is exactly the four hand-wired keywords", () => {
    expect([...DIRECT_HOOK_KEYWORDS].sort()).toEqual(["Berserker", "Flying", "Loot", "Untouchable"]);
  });

  test("DIRECT_HOOK_KEYWORDS only names governed keywords", () => {
    const names = new Set(KEYWORD_SPECS.map((k) => k.name));
    for (const name of DIRECT_HOOK_KEYWORDS) {
      expect(names.has(name)).toBe(true);
    }
  });

  // The mission+role cross-parameter rule lives in parseKeyword, so the build
  // rejects the token. It used to be enforced at resolution time instead,
  // which meant a CSV could build green and then throw on every engine action.
  test("the build rejects a role on a mission-context token", () => {
    expect(() => parseKeyword("Prowess:+2:cunning:mission:def", "unit")).toThrow(KeywordError);
    expect(() => parseKeyword("Prowess:+2:cunning:mission", "unit")).not.toThrow();
  });
});

describe("build transform — unit passives column", () => {
  // The `passives` column carries named passive abilities as `name:effect`,
  // split from the freeform `text` blob (#202). Effect prose is kept verbatim
  // after the first colon (it may itself contain colons); nameless / colon-less
  // tokens drop, mirroring parseAction's tolerance.
  const passivesOf = (raw: string) =>
    (transformCard("units", row({ passives: raw })) as { passives?: unknown }).passives;

  test("parses a single name:effect passive", () => {
    expect(passivesOf("Horselord:Your Equip actions involving a Mount cost 0 AP.")).toEqual([
      { name: "Horselord", effect: "Your Equip actions involving a Mount cost 0 AP." },
    ]);
  });

  test("splits multiple passives on `;` and keeps colons in the effect", () => {
    expect(passivesOf("Alpha:Ratio is 3:1 here.;Beta:Does a thing.")).toEqual([
      { name: "Alpha", effect: "Ratio is 3:1 here." },
      { name: "Beta", effect: "Does a thing." },
    ]);
  });

  test("drops a nameless or colon-less token", () => {
    expect(passivesOf("Berserker")).toEqual([]);
    expect(passivesOf(":no name here")).toEqual([]);
  });

  test("drops a token whose name or effect is whitespace-only", () => {
    // The trim-to-empty branch of parsePassive: a colon is present but one side
    // is blank. Must drop (and warn), matching the Python renderer's parse_card.
    expect(passivesOf("Name:   ")).toEqual([]);
    expect(passivesOf("   :effect")).toEqual([]);
  });

  test("absent column yields an empty list", () => {
    expect(passivesOf("")).toEqual([]);
  });

  test("routes a dropped passive to the warnings sink, not console.warn (#213)", () => {
    // A malformed passive is a non-failing notice; per the structured warnings
    // channel it must land in the sink buildSet threads through, not a bare
    // console.warn. buildSet passes its `warnings` array here.
    const warnings: BuildWarning[] = [];
    transformCard("units", row({ passives: ":no name here" }), warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ field: "passives", severity: "warning" });
    expect(warnings[0].message).toContain("not name:effect");
  });
});

describe("build transform + validation — event resolution (#231)", () => {
  // `resolution` is the event lifecycle destination: absent/empty defaults to
  // `discard` in transform, and out-of-vocab values fail validation (the same
  // governed-column gate as event_type/location_type). Both halves are pinned
  // here — nothing else exercises them (no card CSV declares the column yet).
  const resolutionOf = (overrides: Record<string, string>) =>
    (transformCard("events", row({ timing: "instant", ...overrides })) as {
      resolution?: unknown;
    }).resolution;

  test("defaults an absent resolution to `discard`", () => {
    expect(resolutionOf({})).toBe("discard");
  });

  test("preserves an explicit `main-top`", () => {
    expect(resolutionOf({ resolution: "main-top" })).toBe("main-top");
  });

  test("treats an empty resolution as the `discard` default", () => {
    expect(resolutionOf({ resolution: "" })).toBe("discard");
  });

  test("trims surrounding whitespace before defaulting/validating", () => {
    // A stray space (or CRLF `\r`) must not masquerade as an invalid value.
    expect(resolutionOf({ resolution: "  main-top  " })).toBe("main-top");
  });

  test("accepts a card carrying a governed resolution", () => {
    expect(
      check("events", { timing: "instant", event_type: "Catastrophe", resolution: "main-top" }),
    ).toEqual([]);
  });

  test("rejects an un-governed resolution", () => {
    const errors = check("events", { timing: "instant", resolution: "main-deck" });
    expect(errors.some((e) => e.field === "resolution" && e.message.includes("main-deck"))).toBe(true);
  });

  test("validation is case-sensitive on resolution", () => {
    const errors = check("events", { timing: "instant", resolution: "Discard" });
    expect(errors.some((e) => e.field === "resolution")).toBe(true);
  });
});

describe("build transform + validation — main-body copies (#284)", () => {
  // `copies` is the deck-copy allowance, added ahead of the content passes so
  // authors can express intent without a later retro-edit across the set.
  // Main-body only — see library/schema.md § Main-Body Columns for why.
  // Nothing reads the value yet, so these tests are the only thing pinning
  // transform's default and validate's gate.
  const copiesOf = (type: CardType, overrides: Record<string, string>) =>
    (transformCard(type, row(type === "events" ? { timing: "instant", ...overrides } : overrides)) as {
      copies?: unknown;
    }).copies;

  test.each<CardType>(["units", "items", "events"])(
    "defaults an absent copies to 1 on %s",
    (type) => {
      expect(copiesOf(type, {})).toBe(1);
    },
  );

  test("treats an empty copies as the default 1", () => {
    // An author who adds the column but leaves a cell blank means "baseline",
    // not "malformed" — same tolerance as the `resolution` column above.
    expect(copiesOf("units", { copies: "" })).toBe(1);
  });

  test("preserves an explicit count", () => {
    expect(copiesOf("units", { copies: "3" })).toBe(3);
  });

  test("trims surrounding whitespace before parsing", () => {
    // A stray space, or a stray carriage return from a spreadsheet export,
    // must not make a valid count look malformed.
    expect(copiesOf("items", { copies: "  2  " })).toBe(2);
  });

  test.each<CardType>(["units", "items", "events"])(
    "accepts a governed copies value on %s",
    (type) => {
      const overrides: Record<string, string> =
        type === "events" ? { timing: "instant", copies: "2" } : { copies: "2" };
      expect(check(type, overrides)).toEqual([]);
    },
  );

  test("rejects a non-numeric copies", () => {
    const errors = check("units", { copies: "two" });
    expect(errors.some((e) => e.field === "copies" && e.message.includes("two"))).toBe(true);
  });

  test("rejects a numeric-prefixed value rather than coercing it", () => {
    // `parseInt("3abc")` is 3 — the silent coercion transform deliberately
    // avoids, since it would ship a count the author never wrote.
    const errors = check("units", { copies: "3abc" });
    expect(errors.some((e) => e.field === "copies" && e.message.includes("3abc"))).toBe(true);
  });

  test.each(["0", "-1"])("rejects a non-positive copies (%s)", (value) => {
    // Zero copies would mean an undeckable card; a negative one is nonsense.
    expect(check("units", { copies: value }).some((e) => e.field === "copies")).toBe(true);
  });

  test.each<CardType>(["locations", "policies"])(
    "rejects copies on %s — main-body types only",
    (type) => {
      const errors = check(type, { copies: "2" });
      expect(errors.some((e) => e.field === "copies" && e.message.includes("main-body"))).toBe(true);
    },
  );

  test.each<CardType>(["locations", "policies"])(
    "emits no copies field on %s when the column is absent",
    (type) => {
      // The rejection above only fires on a value actually present, so a normal
      // location/policy row must come out of transform without the key at all.
      expect(copiesOf(type, {})).toBeUndefined();
    },
  );
});

describe("build validation — cost is a numeric gold amount", () => {
  test("accepts an integer cost and `|`-separated integer alternatives", () => {
    expect(check("units", { cost: "3", attributes: "Military" })).toEqual([]);
    expect(check("units", { cost: "4|2", attributes: "Military" })).toEqual([]);
    expect(check("locations", { cost: "0", location_type: "Market" })).toEqual([]);
  });

  test("rejects a non-numeric cost", () => {
    const errors = check("units", { cost: "3g", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });

  test("rejects a blank cost", () => {
    const errors = check("units", { cost: "", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });

  test("rejects when any alternative-cost option is non-numeric", () => {
    const errors = check("units", { cost: "4|X", attributes: "Military" });
    expect(errors.some((e) => e.field === "cost")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Record splitting: line endings and quoted newlines (#289)
//
// See `splitRecords` for the mechanism. The blast radius is what makes these
// worth pinning: a CRLF checkout emptied the last column of every CSV — flavor
// on units, items and locations, `effect` on events, `actions` on policies —
// and the eventless games then stalled the greedy-bot integration suite in a
// tie it could not break. CRLF is not Windows-only: spreadsheet exports produce
// it too, and the same export is what writes a quoted newline into a multi-line
// flavor text.
// ---------------------------------------------------------------------------
describe("build — record splitting (#289)", () => {
  const fixtureRoot: string = mkdtempSync(join(tmpdir(), "cards-crlf-"));
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  /** Write a two-card fixture set whose lines are joined with `eol`. */
  function makeSet(name: string, eol: string): void {
    const dir: string = join(fixtureRoot, name);
    mkdirSync(dir, { recursive: true });
    // `effect` and `flavor` sit last on purpose — mirroring the real events.csv
    // and units.csv column order, since the last column is the only one a
    // trailing \r can corrupt.
    writeFileSync(
      join(dir, "events.csv"),
      [
        "id,name,set,rarity,cost,timing,keywords,attributes,text,flavor,effect",
        "crlf-event,CRLF Event,crlf-set,common,2,instant,,,,Flavour here,gold[3]",
      ].join(eol) + eol,
    );
    writeFileSync(
      join(dir, "units.csv"),
      [
        "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,flavor",
        "crlf-unit,CRLF Unit,crlf-set,common,3,,Military,2,1,1,Some flavour",
      ].join(eol) + eol,
    );
  }

  test("keeps the last column when lines end in CRLF", () => {
    makeSet("crlf-set", "\r\n");
    const { cards, errors } = buildSet("crlf-set", fixtureRoot);

    expect(errors).toEqual([]);
    const event = cards.find((c) => (c.id as string) === "crlf-event");
    const unit = cards.find((c) => (c.id as string) === "crlf-unit");
    expect(event?.effect).toBe("gold[3]");
    expect(unit?.flavor).toBe("Some flavour");
  });

  test("leaves no carriage return in any built value", () => {
    // The trailing \r also rode along on the last *value* of every row, so a
    // build that merely renamed the header back would still ship dirty data.
    makeSet("crlf-set-dirty", "\r\n");
    const { cards } = buildSet("crlf-set-dirty", fixtureRoot);

    expect(JSON.stringify(cards)).not.toContain("\r");
  });

  test("LF files are unaffected", () => {
    makeSet("lf-set", "\n");
    const { cards, errors } = buildSet("lf-set", fixtureRoot);

    expect(errors).toEqual([]);
    expect(cards.find((c) => (c.id as string) === "crlf-event")?.effect).toBe("gold[3]");
  });
  test("keeps a quoted field containing a newline in one record", () => {
    // What a spreadsheet writes for multi-line flavor text. Splitting on line
    // endings first tore this into a truncated row plus a phantom row whose id
    // was the second line — silently, because flavor is optional.
    const dir: string = join(fixtureRoot, "quoted-newline");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "units.csv"),
      'id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,flavor\r\n' +
        'quoted-unit,Quoted Unit,q-set,common,3,,Military,2,1,1,"First line\r\nSecond line"\r\n',
    );
    const { cards, errors } = buildSet("quoted-newline", fixtureRoot);

    expect(errors).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0].flavor).toBe("First line\r\nSecond line");
  });

  test("reports a row whose field count disagrees with the header", () => {
    // A dropped comma used to shift every later column in silence. The error
    // names the line number the author's editor shows.
    const dir: string = join(fixtureRoot, "ragged");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "units.csv"),
      "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,flavor\n" +
        "ragged-unit,Ragged Unit,r-set,common,3,,Military,2,1,1\n",
    );
    const { errors } = buildSet("ragged", fixtureRoot);

    const raggedError = errors.find((e) => e.field === "row");
    expect(raggedError).toBeDefined();
    expect(raggedError?.message).toContain("line 2");
    expect(raggedError?.message).toContain("10 field(s)");
  });

  test("warns about a header the build never reads", () => {
    // The generalised form of the bug: any column the transform doesn't consume
    // is authored data being thrown away. `seeding_effect` sat unbuilt on every
    // policy for exactly this reason, and nothing said so.
    const dir: string = join(fixtureRoot, "unread-column");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "units.csv"),
      "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,flavour\n" +
        "typo-unit,Typo Unit,u-set,common,3,,Military,2,1,1,Misspelled header\n",
    );
    const { warnings } = buildSet("unread-column", fixtureRoot);

    const unread = warnings.find((w) => w.field === "flavour");
    expect(unread).toBeDefined();
    expect(unread?.message).toContain("not read by the build");
  });
});

describe("build — columns that used to be dropped", () => {
  // Both columns are documented in library/schema.md and carried real authored
  // values in alpha-1, and the build read neither — the same silent-drop class
  // as the record-splitting bug above, found while reviewing its fix.
  const fixtureRoot: string = mkdtempSync(join(tmpdir(), "cards-dropped-"));
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  test("carries a policy's seeding_effect through to the built card", () => {
    const dir: string = join(fixtureRoot, "policy-set");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "policies.csv"),
      "id,name,set,rarity,cost,effect,attributes,keywords,text,flavor,seeding_effect,actions\n" +
        "test-policy,Test Policy,p-set,common,0,Global modifier.,,,,,Swap one card before Claim.,\n",
    );
    const { cards, errors } = buildSet("policy-set", fixtureRoot);

    expect(errors).toEqual([]);
    expect(cards[0].seedingEffect).toBe("Swap one card before Claim.");
  });

  test("carries a location's blocked edges through to the built card", () => {
    const dir: string = join(fixtureRoot, "edge-set");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "locations.csv"),
      "id,name,set,rarity,cost,mission,passive,edges,attributes,keywords,location_type,text,flavor\n" +
        "walled,Walled Place,l-set,common,4,,,N;S,,,Fortification,,\n",
    );
    const { cards, errors } = buildSet("edge-set", fixtureRoot);

    expect(errors).toEqual([]);
    expect(cards[0].edges).toEqual(["N", "S"]);
  });

  test("rejects an edge token outside the compass set", () => {
    // A typo'd token would otherwise reach the loader and quietly leave that
    // edge open, which is indistinguishable from the author not blocking it.
    const dir: string = join(fixtureRoot, "bad-edge-set");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "locations.csv"),
      "id,name,set,rarity,cost,mission,passive,edges,attributes,keywords,location_type,text,flavor\n" +
        "typo-edge,Typo Edge,l-set,common,4,,,North,,,Fortification,,\n",
    );
    const { errors } = buildSet("bad-edge-set", fixtureRoot);

    expect(errors.some((e) => e.field === "edges" && e.message.includes("North"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structured warnings channel (#213)
//
// Non-failing build notices (e.g. a missing per-type CSV) return via
// `buildSet().warnings` instead of a bare `console.warn`, so they can be
// surfaced in the summary and asserted on here. Errors stay in `.errors`.
// ---------------------------------------------------------------------------
describe("build warnings — structured non-failing channel", () => {
  const fixtureRoot: string = mkdtempSync(join(tmpdir(), "cards-buildset-"));
  afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  /** Write a fixture set with only the given card-type CSVs present. */
  function makeSet(name: string, csvs: Partial<Record<CardType, string>>): void {
    const dir: string = join(fixtureRoot, name);
    mkdirSync(dir, { recursive: true });
    for (const [type, body] of Object.entries(csvs)) {
      writeFileSync(join(dir, `${type}.csv`), body);
    }
  }

  const UNIT_CSV: string =
    "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,actions\n" +
    "warn-unit,Warn Unit,warn-set,common,3,,Military,2,1,1,\n";

  test("emits a warning per missing card-type CSV, without erroring", () => {
    // Only units.csv present → the other four types warn but don't fail.
    makeSet("warn-set", { units: UNIT_CSV });
    const { cards, errors, warnings } = buildSet("warn-set", fixtureRoot);

    expect(cards.length).toBe(1);
    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.field).sort()).toEqual([
      "events",
      "items",
      "locations",
      "policies",
    ]);
    for (const w of warnings) {
      expect(w.card).toBe("warn-set");
      expect(w.severity).toBe("warning");
      // Pin the human-readable message: it names the missing file and its disposition.
      expect(w.message).toContain(`${w.field}.csv`);
      expect(w.message).toContain("not found");
    }
  });

  test("warnings and errors coexist as disjoint channels in one build", () => {
    // units.csv holds a card with an invalid rarity (→ error); the other four
    // types are absent (→ warnings). The channels must not bleed into each other.
    const BAD_UNIT_CSV: string =
      "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,actions\n" +
      "bad-unit,Bad Unit,mixed-set,not-a-rarity,3,,Military,2,1,1,\n";
    makeSet("mixed-set", { units: BAD_UNIT_CSV });
    const { errors, warnings } = buildSet("mixed-set", fixtureRoot);

    expect(errors.some((e) => e.field === "rarity")).toBe(true);
    expect(errors.every((e) => e.severity === "error")).toBe(true);
    expect(warnings.length).toBe(4);
    expect(warnings.every((w) => w.severity === "warning")).toBe(true);
    // No warning leaked into errors, no error into warnings.
    expect(warnings.every((w) => w.message.includes("not found"))).toBe(true);
    expect(errors.some((e) => e.message.includes("not found"))).toBe(false);
  });

  test("a nonexistent set directory fails the build instead of warning", () => {
    const { cards, errors, warnings } = buildSet("does-not-exist", fixtureRoot);
    expect(cards).toEqual([]);
    expect(warnings).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe("set");
    expect(errors[0].severity).toBe("error");
  });

  test("no warnings when every card-type CSV is present", () => {
    // Header-only fixtures for the non-unit types are intentional: the warning
    // path keys purely on file existence (existsSync), so a present-but-empty CSV
    // is enough to prove "present → no warning". Card-row flow into cards[] is
    // covered by the UNIT_CSV rows in the tests above.
    makeSet("full-set", {
      units: UNIT_CSV,
      locations: "id,name,set,rarity,cost,keywords,attributes,location_type\n",
      items: "id,name,set,rarity,cost,keywords,attributes,type\n",
      events: "id,name,set,rarity,cost,keywords,attributes,timing\n",
      policies: "id,name,set,rarity,cost,keywords,attributes,effect\n",
    });
    const { warnings } = buildSet("full-set", fixtureRoot);
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Build CLI — main() summary rendering and exit codes (#213)
//
// buildSet()'s return value is unit-tested above; the fail/no-fail contract
// itself lives in main() (warnings are non-failing, errors exit 1, warnings
// print before errors). main() isn't exported, so we drive it as a subprocess,
// pointing CARDS_SETS_DIR/CARDS_BUILD_DIR at temp dirs for isolation.
// ---------------------------------------------------------------------------
describe("build CLI — main() summary and exit codes", () => {
  const cliRoot: string = mkdtempSync(join(tmpdir(), "cards-buildcli-"));
  const cliBuild: string = mkdtempSync(join(tmpdir(), "cards-buildout-"));
  afterAll(() => {
    rmSync(cliRoot, { recursive: true, force: true });
    rmSync(cliBuild, { recursive: true, force: true });
  });

  const BUILD_SCRIPT: string = join(import.meta.dir, "../library/build.ts");
  const CLI_UNIT_CSV: string =
    "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,actions\n" +
    "cli-unit,CLI Unit,cli,common,3,,Military,2,1,1,\n";

  /** Write a fixture set, then run `bun library/build.ts <setName>` against it. */
  function run(
    setName: string,
    csvs: Partial<Record<CardType, string>>,
  ): { code: number | null; stderr: string } {
    const dir: string = join(cliRoot, setName);
    mkdirSync(dir, { recursive: true });
    for (const [type, body] of Object.entries(csvs)) {
      writeFileSync(join(dir, `${type}.csv`), body);
    }
    const proc = Bun.spawnSync(["bun", BUILD_SCRIPT, setName], {
      env: { ...process.env, CARDS_SETS_DIR: cliRoot, CARDS_BUILD_DIR: cliBuild },
    });
    return { code: proc.exitCode, stderr: proc.stderr.toString() };
  }

  test("a warning-only build prints the warning summary and exits 0", () => {
    // Only units.csv → the other four types warn, nothing errors.
    const { code, stderr } = run("cli-warn", { units: CLI_UNIT_CSV });
    expect(code).toBe(0);
    expect(stderr).toContain("warning(s):");
    expect(stderr).toContain("events.csv not found");
  });

  test("a validation error fails the build (exit 1), printed after warnings", () => {
    const BAD_UNIT_CSV: string =
      "id,name,set,rarity,cost,keywords,attributes,strength,cunning,charisma,actions\n" +
      "cli-bad,CLI Bad,cli,not-a-rarity,3,,Military,2,1,1,\n";
    const { code, stderr } = run("cli-err", { units: BAD_UNIT_CSV });
    expect(code).toBe(1);
    expect(stderr).toContain("validation error(s):");
    // Warnings (the four missing CSVs) must print before the error summary.
    const warnIdx: number = stderr.indexOf("warning(s):");
    const errIdx: number = stderr.indexOf("validation error(s):");
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(errIdx).toBeGreaterThan(warnIdx);
  });
});
