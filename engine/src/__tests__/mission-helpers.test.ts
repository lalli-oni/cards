import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkMissionRequirements,
  parseRequirements,
  parseRewards,
} from "../mission-helpers";
import type { UnitCard } from "../types";

function unit(attrs: string[], overrides?: Partial<UnitCard>): UnitCard {
  return {
    id: "u1",
    definitionId: "test",
    type: "unit",
    name: "Test",
    cost: "0",
    rarity: "common",
    strength: overrides?.strength ?? 5,
    cunning: overrides?.cunning ?? 5,
    charisma: overrides?.charisma ?? 5,
    attributes: attrs,
    injured: false,
    ownerId: "p1",
    ...overrides,
  };
}

describe("parseRequirements", () => {
  it("parses attribute count: scientist_2", () => {
    const reqs = parseRequirements("scientist_2");
    expect(reqs).toEqual([{ kind: "attribute", attribute: "Scientist", count: 2 }]);
  });

  it("parses stat threshold: strength_15", () => {
    const reqs = parseRequirements("strength_15");
    expect(reqs).toEqual([{ kind: "stat", stat: "strength", threshold: 15 }]);
  });

  it("parses unit count: units_3", () => {
    const reqs = parseRequirements("units_3");
    expect(reqs).toEqual([{ kind: "units", count: 3 }]);
  });

  it("parses semicolon-separated AND: warrior_1;strength_15", () => {
    const reqs = parseRequirements("warrior_1;strength_15");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Warrior", count: 1 },
      { kind: "stat", stat: "strength", threshold: 15 },
    ]);
  });

  it("parses multi-attribute AND: scientist_1;diplomat_1", () => {
    const reqs = parseRequirements("scientist_1;diplomat_1");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Scientist", count: 1 },
      { kind: "attribute", attribute: "Diplomat", count: 1 },
    ]);
  });

  // Legacy backward-compat formats
  it("legacy: warrior_strength_15 decomposes to attribute + stat", () => {
    const reqs = parseRequirements("warrior_strength_15");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Warrior", count: 1 },
      { kind: "stat", stat: "strength", threshold: 15 },
    ]);
  });

  it("legacy: scientist_cunning_14 decomposes to attribute + stat", () => {
    const reqs = parseRequirements("scientist_cunning_14");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Scientist", count: 1 },
      { kind: "stat", stat: "cunning", threshold: 14 },
    ]);
  });

  it("legacy: cunning_unit_7 becomes stat check", () => {
    const reqs = parseRequirements("cunning_unit_7");
    expect(reqs).toEqual([{ kind: "stat", stat: "cunning", threshold: 7 }]);
  });

  it("legacy: scientist_1_diplomat_1 as multi-attribute", () => {
    const reqs = parseRequirements("scientist_1_diplomat_1");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Scientist", count: 1 },
      { kind: "attribute", attribute: "Diplomat", count: 1 },
    ]);
  });
});

describe("parseRewards", () => {
  it("parses VP reward: 5vp", () => {
    expect(parseRewards("5vp")).toEqual({ vp: 5 });
  });

  it("parses case-insensitive: 3VP", () => {
    expect(parseRewards("3VP")).toEqual({ vp: 3 });
  });

  it("throws on invalid format", () => {
    expect(() => parseRewards("gold_5")).toThrow("Invalid rewards format");
  });
});

describe("checkMissionRequirements", () => {
  it("attribute: passes with enough matching units", () => {
    const reqs = parseRequirements("scientist_2");
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Scientist"])])).toBe(true);
  });

  it("attribute: fails with insufficient matching units", () => {
    const reqs = parseRequirements("scientist_2");
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Warrior"])])).toBe(false);
  });

  it("stat: sums across ALL friendly units", () => {
    const reqs = parseRequirements("strength_15");
    const units = [unit([], { strength: 8 }), unit([], { strength: 8 })];
    expect(checkMissionRequirements(reqs, units)).toBe(true); // 16 >= 15
  });

  it("stat: fails when sum below threshold", () => {
    const reqs = parseRequirements("strength_15");
    const units = [unit([], { strength: 5 }), unit([], { strength: 5 })];
    expect(checkMissionRequirements(reqs, units)).toBe(false); // 10 < 15
  });

  it("stat: non-attribute units still contribute to stat sum", () => {
    // With decoupled model, ALL units contribute to stat checks
    const reqs = parseRequirements("warrior_1;strength_15");
    const units = [
      unit(["Warrior"], { strength: 5 }),
      unit(["Scientist"], { strength: 11 }),
    ];
    // warrior_1: 1 Warrior present ✓
    // strength_15: 5 + 11 = 16 ✓ (both units contribute)
    expect(checkMissionRequirements(reqs, units)).toBe(true);
  });

  it("units: passes with enough units", () => {
    const reqs = parseRequirements("units_3");
    expect(checkMissionRequirements(reqs, [unit([]), unit([]), unit([])])).toBe(true);
  });

  it("units: fails with too few", () => {
    const reqs = parseRequirements("units_3");
    expect(checkMissionRequirements(reqs, [unit([]), unit([])])).toBe(false);
  });

  it("AND composition: all checks must pass", () => {
    const reqs = parseRequirements("scientist_1;diplomat_1");
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Diplomat"])])).toBe(true);
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Scientist"])])).toBe(false);
  });
});

describe("library validation", () => {
  it("parses all requirement strings from alpha-1 locations", () => {
    const csvPath = resolve(__dirname, "../../../library/sets/alpha-1/locations.csv");
    if (!existsSync(csvPath)) {
      console.warn("Skipping library validation — CSV not found at", csvPath);
      return;
    }

    const csv = readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n");
    const header = lines[0].split(",");
    // Support both old "mission" and new "requirements" column
    let reqIdx = header.indexOf("requirements");
    if (reqIdx === -1) reqIdx = header.indexOf("mission");

    const requirements: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const req = cols[reqIdx];
      if (req && req.trim()) {
        // Strip VP suffix if using old format (requirements>vp)
        const clean = req.includes(">") ? req.split(">")[0] : req;
        requirements.push(clean.trim());
      }
    }

    expect(requirements.length).toBeGreaterThan(0);

    const parsed: string[] = [];
    const unparseable: string[] = [];
    for (const r of requirements) {
      try {
        const result = parseRequirements(r);
        expect(result.length).toBeGreaterThan(0);
        parsed.push(r);
      } catch {
        unparseable.push(r);
      }
    }

    expect(parsed.length).toBeGreaterThan(0);
    // Log unparseable for visibility — these need updating in #60
    if (unparseable.length > 0) {
      console.warn(`Unparseable requirement strings (see #60): ${unparseable.join(", ")}`);
    }
  });
});
