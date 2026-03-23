import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkMissionRequirements,
  parseMission,
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

describe("parseMission", () => {
  it("parses attribute count: scientist_2>5", () => {
    const m = parseMission("scientist_2>5");
    expect(m.vp).toBe(5);
    expect(m.requirements).toEqual([
      { kind: "attribute_count", attribute: "Scientist", count: 2 },
    ]);
  });

  it("parses attribute stat: warrior_strength_15>4", () => {
    const m = parseMission("warrior_strength_15>4");
    expect(m.vp).toBe(4);
    expect(m.requirements).toEqual([
      { kind: "attribute_stat", attribute: "Warrior", stat: "strength", threshold: 15 },
    ]);
  });

  it("parses unit count: units_3>5", () => {
    const m = parseMission("units_3>5");
    expect(m.vp).toBe(5);
    expect(m.requirements).toEqual([{ kind: "unit_count", count: 3 }]);
  });

  it("parses different attributes: units_3_different_attributes>3", () => {
    const m = parseMission("units_3_different_attributes>3");
    expect(m.vp).toBe(3);
    expect(m.requirements).toEqual([{ kind: "different_attributes", count: 3 }]);
  });

  it("parses multi-attribute: scientist_1_diplomat_1>3", () => {
    const m = parseMission("scientist_1_diplomat_1>3");
    expect(m.vp).toBe(3);
    expect(m.requirements).toEqual([
      { kind: "attribute_count", attribute: "Scientist", count: 1 },
      { kind: "attribute_count", attribute: "Diplomat", count: 1 },
    ]);
  });

  it("parses single unit stat: cunning_unit_7>3", () => {
    const m = parseMission("cunning_unit_7>3");
    expect(m.vp).toBe(3);
    expect(m.requirements).toEqual([
      { kind: "unit_stat", stat: "cunning", threshold: 7 },
    ]);
  });

  it("parses attribute + stat: scientist_cunning_14>4", () => {
    const m = parseMission("scientist_cunning_14>4");
    expect(m.vp).toBe(4);
    expect(m.requirements).toEqual([
      { kind: "attribute_stat", attribute: "Scientist", stat: "cunning", threshold: 14 },
    ]);
  });

  it("parses politician_charisma_20>7", () => {
    const m = parseMission("politician_charisma_20>7");
    expect(m.vp).toBe(7);
    expect(m.requirements).toEqual([
      { kind: "attribute_stat", attribute: "Politician", stat: "charisma", threshold: 20 },
    ]);
  });

  it("throws on missing VP", () => {
    expect(() => parseMission("scientist_2")).toThrow("missing");
  });
});

describe("checkMissionRequirements", () => {
  it("attribute_count: passes with enough matching units", () => {
    const reqs = parseMission("scientist_2>5").requirements;
    const units = [unit(["Scientist"]), unit(["Scientist"]), unit(["Warrior"])];
    expect(checkMissionRequirements(reqs, units)).toBe(true);
  });

  it("attribute_count: fails with insufficient matching units", () => {
    const reqs = parseMission("scientist_2>5").requirements;
    const units = [unit(["Scientist"]), unit(["Warrior"])];
    expect(checkMissionRequirements(reqs, units)).toBe(false);
  });

  it("attribute_stat: passes when combined stat meets threshold", () => {
    const reqs = parseMission("warrior_strength_15>4").requirements;
    const units = [
      unit(["Warrior"], { strength: 8 }),
      unit(["Warrior"], { strength: 8 }),
    ];
    expect(checkMissionRequirements(reqs, units)).toBe(true);
  });

  it("attribute_stat: fails when combined stat below threshold", () => {
    const reqs = parseMission("warrior_strength_15>4").requirements;
    const units = [
      unit(["Warrior"], { strength: 5 }),
      unit(["Warrior"], { strength: 5 }),
    ];
    expect(checkMissionRequirements(reqs, units)).toBe(false);
  });

  it("attribute_stat: non-matching attributes don't contribute", () => {
    const reqs = parseMission("warrior_strength_15>4").requirements;
    const units = [
      unit(["Warrior"], { strength: 8 }),
      unit(["Scientist"], { strength: 20 }),
    ];
    expect(checkMissionRequirements(reqs, units)).toBe(false);
  });

  it("unit_count: passes with enough units", () => {
    const reqs = parseMission("units_3>5").requirements;
    expect(checkMissionRequirements(reqs, [unit([]), unit([]), unit([])])).toBe(true);
  });

  it("unit_count: fails with too few", () => {
    const reqs = parseMission("units_3>5").requirements;
    expect(checkMissionRequirements(reqs, [unit([]), unit([])])).toBe(false);
  });

  it("unit_stat: passes when any unit meets threshold", () => {
    const reqs = parseMission("cunning_unit_7>3").requirements;
    expect(checkMissionRequirements(reqs, [unit([], { cunning: 8 })])).toBe(true);
  });

  it("unit_stat: fails when no unit meets threshold", () => {
    const reqs = parseMission("cunning_unit_7>3").requirements;
    expect(checkMissionRequirements(reqs, [unit([], { cunning: 5 })])).toBe(false);
  });

  it("different_attributes: passes with distinct attributes", () => {
    const reqs = parseMission("units_3_different_attributes>3").requirements;
    const units = [unit(["Scientist"]), unit(["Warrior"]), unit(["Diplomat"])];
    expect(checkMissionRequirements(reqs, units)).toBe(true);
  });

  it("different_attributes: fails with duplicate attributes", () => {
    const reqs = parseMission("units_3_different_attributes>3").requirements;
    const units = [unit(["Scientist"]), unit(["Scientist"]), unit(["Warrior"])];
    expect(checkMissionRequirements(reqs, units)).toBe(false);
  });

  it("multi-requirement: both must be met", () => {
    const reqs = parseMission("scientist_1_diplomat_1>3").requirements;
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Diplomat"])])).toBe(true);
    expect(checkMissionRequirements(reqs, [unit(["Scientist"]), unit(["Scientist"])])).toBe(false);
  });
});

describe("library validation", () => {
  it("parses all mission strings from alpha-1 locations", () => {
    const csvPath = resolve(__dirname, "../../../library/sets/alpha-1/locations.csv");
    if (!existsSync(csvPath)) {
      console.warn("Skipping library validation — CSV not found at", csvPath);
      return;
    }

    const csv = readFileSync(csvPath, "utf-8");
    const lines = csv.trim().split("\n");
    const header = lines[0].split(",");
    const missionIdx = header.indexOf("mission");

    const missions: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const mission = cols[missionIdx];
      if (mission && mission.trim()) {
        missions.push(mission.trim());
      }
    }

    expect(missions.length).toBeGreaterThan(0);

    for (const m of missions) {
      expect(() => parseMission(m)).not.toThrow();
      const parsed = parseMission(m);
      expect(parsed.vp).toBeGreaterThan(0);
      expect(parsed.requirements.length).toBeGreaterThan(0);
    }
  });
});
