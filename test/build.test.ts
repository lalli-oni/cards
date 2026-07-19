import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSet,
  transformCard,
  validate,
  type CardType,
} from "../library/build";
import { KEYWORDS } from "../engine/src/keywords";

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
    expect(check("units", { attributes: "Military", keywords: "Berserker;Leader:+1:all:combat" })).toEqual([]);
    expect(check("items", { type: "Banner", keywords: "Flying" })).toEqual([]);
    expect(check("locations", { location_type: "Market", keywords: "Aura:-1:all:combat" })).toEqual([]);
  });

  test("rejects an unknown keyword", () => {
    const errors = check("units", { attributes: "Military", keywords: "Lethal" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("unknown keyword"))).toBe(true);
  });

  test("rejects a malformed family token (unsigned magnitude)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Leader:1:all:combat" });
    expect(errors.some((e) => e.field === "keywords" && e.message.includes("magnitude"))).toBe(true);
  });

  test("rejects an unsupported card type (Aura on a unit)", () => {
    const errors = check("units", { attributes: "Military", keywords: "Aura:-1:all:combat" });
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
    expect(artifact.length).toBe(KEYWORDS.length);
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
    const names = KEYWORDS.map((k) => k.name);
    expect(new Set(names).size).toBe(names.length);
    for (const k of KEYWORDS) {
      const paramNames = k.params.map((p) => p.name);
      expect(new Set(paramNames).size).toBe(paramNames.length);
    }
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
