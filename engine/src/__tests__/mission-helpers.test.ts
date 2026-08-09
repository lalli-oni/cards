import { describe, expect, it } from "bun:test";
import { produce } from "immer";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkMissionRequirements,
  parseRequirements,
  parseRewards,
} from "../mission-helpers";
import { isAttribute } from "../attributes";
import type { Attribute } from "../attributes";
import { createTestGame, makeLocation } from "./helpers";
import { rebuildListeners } from "../listeners/rebuild";
import { getValidActions } from "../valid-actions";
import type { MainGameState, UnitCard } from "../types";

function unit(attrs: Attribute[], overrides?: Partial<UnitCard>): UnitCard {
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
    controllerId: "p1",
    ...overrides,
  };
}

describe("parseRequirements", () => {
  it("parses attribute count: knowledge_2", () => {
    const reqs = parseRequirements("knowledge_2");
    expect(reqs).toEqual([{ kind: "attribute", attribute: "Knowledge", count: 2 }]);
  });

  it("parses stat threshold: strength_15", () => {
    const reqs = parseRequirements("strength_15");
    expect(reqs).toEqual([{ kind: "stat", stat: "strength", threshold: 15 }]);
  });

  it("parses unit count: units_3", () => {
    const reqs = parseRequirements("units_3");
    expect(reqs).toEqual([{ kind: "units", count: 3 }]);
  });

  it("parses semicolon-separated AND: military_1;strength_15", () => {
    const reqs = parseRequirements("military_1;strength_15");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Military", count: 1 },
      { kind: "stat", stat: "strength", threshold: 15 },
    ]);
  });

  it("parses multi-attribute AND: knowledge_1;diplomacy_1", () => {
    const reqs = parseRequirements("knowledge_1;diplomacy_1");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Knowledge", count: 1 },
      { kind: "attribute", attribute: "Diplomacy", count: 1 },
    ]);
  });

  // Legacy backward-compat formats
  it("legacy: military_strength_15 decomposes to attribute + stat", () => {
    const reqs = parseRequirements("military_strength_15");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Military", count: 1 },
      { kind: "stat", stat: "strength", threshold: 15 },
    ]);
  });

  it("legacy: knowledge_cunning_14 decomposes to attribute + stat", () => {
    const reqs = parseRequirements("knowledge_cunning_14");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Knowledge", count: 1 },
      { kind: "stat", stat: "cunning", threshold: 14 },
    ]);
  });

  it("legacy: cunning_unit_7 becomes stat check", () => {
    const reqs = parseRequirements("cunning_unit_7");
    expect(reqs).toEqual([{ kind: "stat", stat: "cunning", threshold: 7 }]);
  });

  it("legacy: knowledge_1_diplomacy_1 as multi-attribute", () => {
    const reqs = parseRequirements("knowledge_1_diplomacy_1");
    expect(reqs).toEqual([
      { kind: "attribute", attribute: "Knowledge", count: 1 },
      { kind: "attribute", attribute: "Diplomacy", count: 1 },
    ]);
  });

  // Vocabulary validation (#158): an un-migrated legacy role-noun or a typo
  // must throw, not parse into an attribute requirement that matches zero
  // units (which would make the mission silently unwinnable).
  it("throws on an un-migrated legacy role-noun: scientist_2", () => {
    expect(() => parseRequirements("scientist_2")).toThrow('Unknown attribute "Scientist"');
  });

  it("throws on a misspelled attribute: diplomancy_1", () => {
    expect(() => parseRequirements("diplomancy_1")).toThrow("Unknown attribute");
  });

  it("accepts governed attribute tokens case-insensitively: KNOWLEDGE_2", () => {
    expect(parseRequirements("KNOWLEDGE_2")).toEqual([
      { kind: "attribute", attribute: "Knowledge", count: 2 },
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
    const reqs = parseRequirements("knowledge_2");
    expect(checkMissionRequirements(reqs, [unit(["Knowledge"]), unit(["Knowledge"])])).toBe(true);
  });

  it("attribute: fails with insufficient matching units", () => {
    const reqs = parseRequirements("knowledge_2");
    expect(checkMissionRequirements(reqs, [unit(["Knowledge"]), unit(["Military"])])).toBe(false);
  });

  it("stat: sums across ALL friendly units", () => {
    const reqs = parseRequirements("strength_15");
    const state = createTestGame();
    const { queries } = rebuildListeners(state);
    const units = [unit([], { strength: 8 }), unit([], { strength: 8 })];
    expect(checkMissionRequirements(reqs, units, state, queries)).toBe(true); // 16 >= 15
  });

  it("stat: fails when sum below threshold", () => {
    const reqs = parseRequirements("strength_15");
    const state = createTestGame();
    const { queries } = rebuildListeners(state);
    const units = [unit([], { strength: 5 }), unit([], { strength: 5 })];
    expect(checkMissionRequirements(reqs, units, state, queries)).toBe(false); // 10 < 15
  });

  it("stat: rejects a stat requirement evaluated without the query layer", () => {
    // Summing base stats would silently drop every keyword and effect buff a
    // mission was designed around, so the omission is a caller bug rather than
    // a degraded-but-usable answer. Attribute and count requirements need no
    // query layer and stay callable without one (see the tests above).
    const reqs = parseRequirements("strength_15");
    expect(() => checkMissionRequirements(reqs, [unit([], { strength: 99 })]))
      .toThrow(/needs state and queries/);
  });

  it("stat: an injured contributor's penalty can flip a mission from met to unmet", () => {
    // Injury is a global -1 to all stats (rules/README.md Unit status), applied
    // to mission stat checks via the same getModifiedStat path production uses
    // — but only when state+queries are supplied. strength_16 with two
    // strength-8 units is met at 16; injuring one drops the modified sum to
    // 8 + (8-1) = 15 → unmet. This closes the mission leg of the #171 "one
    // primitive applies the injury penalty everywhere" claim.
    const reqs = parseRequirements("strength_16");
    const state = createTestGame();
    const { queries } = rebuildListeners(state);

    const healthy1 = unit([], { id: "h1", strength: 8 });
    const healthy2 = unit([], { id: "h2", strength: 8 });
    const hurt = unit([], { id: "i1", strength: 8, injured: true });

    // Both healthy → 16 >= 16 (met).
    expect(checkMissionRequirements(reqs, [healthy1, healthy2], state, queries)).toBe(true);
    // One injured → 8 + 7 = 15 < 16 (unmet) once the penalty is applied.
    expect(checkMissionRequirements(reqs, [healthy1, hurt], state, queries)).toBe(false);
  });

  it("stat: a Prowess:...:mission keyword modifies the sum", () => {
    // Pins the `mission` StatQueryContext occasion end-to-end: the stat-sum
    // path threads `{ mission: true }` into getModifiedStat, so a
    // mission-context keyword on a contributing unit applies here exactly like
    // the injury penalty above. The source stands at the mission's own cell —
    // Prowess ignores position, but placing it in HQ (as this test once did)
    // encodes a board state a real mission attempt can never produce.
    const reqs = parseRequirements("strength_7");
    const source = unit([], { id: "u1", strength: 5, keywords: ["Prowess:+2:strength:mission"] });
    const state = produce(createTestGame(), (d) => {
      d.grid[0][0].location = makeLocation({ ownerId: d.players[0].id });
      d.grid[0][0].units.push(source);
    });
    const { queries } = rebuildListeners(state);

    // 5 + 2 (Prowess under the mission context) = 7 >= 7 (met).
    expect(checkMissionRequirements(reqs, [source], state, queries, { row: 0, col: 0 })).toBe(true);
    // A contest-context token must not leak into the mission sum.
    expect(checkMissionRequirements(
      parseRequirements("strength_7"),
      [unit([], { id: "u2", strength: 5, keywords: ["Prowess:+2:strength:contest"] })],
      state, queries, { row: 0, col: 0 },
    )).toBe(false);
  });

  it("stat: a location's Aura:...:mission buffs the units standing on it", () => {
    // Aura and Leader are position-gated, unlike Prowess — so unless the
    // caller threads `position` through (both production callers do:
    // valid-actions.ts's attempt_mission block and apply-main.ts's
    // handleAttemptMission), a location-scoped mission keyword contributes
    // nothing and the omission is invisible.
    const reqs = parseRequirements("strength_12");
    const u1 = unit([], { id: "a1", strength: 5 });
    const u2 = unit([], { id: "a2", strength: 5 });
    const state = produce(createTestGame(), (d) => {
      d.grid[0][0].location = makeLocation({
        ownerId: d.players[0].id,
        keywords: ["Aura:+1:strength:mission"],
      });
      d.grid[0][0].units.push(u1, u2);
    });
    const { queries } = rebuildListeners(state);

    // (5+1) + (5+1) = 12 >= 12, but only with the position the Aura keys off.
    expect(checkMissionRequirements(reqs, [u1, u2], state, queries, { row: 0, col: 0 })).toBe(true);
    expect(checkMissionRequirements(reqs, [u1, u2], state, queries)).toBe(false);
  });

  it("attempt_mission is offered only once a mission keyword closes the stat gap", () => {
    // The end-to-end leg: a keyword-driven mission buff has to reach
    // getValidActions, not just checkMissionRequirements in isolation.
    const withoutBuff = produce(createTestGame(), (d) => {
      d.grid[0][0].location = makeLocation({
        ownerId: d.players[0].id,
        requirements: "strength_7",
        rewards: "3vp",
      });
      d.grid[0][0].units.push(unit([], {
        id: "m1", strength: 5,
        ownerId: d.turn.activePlayerId, controllerId: d.turn.activePlayerId,
      }));
    });
    const withBuff = produce(withoutBuff, (d) => {
      d.grid[0][0].units[0].keywords = ["Prowess:+2:strength:mission"];
    });
    const offers = (s: MainGameState): boolean =>
      getValidActions(s, s.turn.activePlayerId).some((a) => a.type === "attempt_mission");

    expect(offers(withoutBuff)).toBe(false);
    expect(offers(withBuff)).toBe(true);
  });

  it("stat: non-attribute units still contribute to stat sum", () => {
    // With decoupled model, ALL units contribute to stat checks
    const reqs = parseRequirements("military_1;strength_15");
    const state = createTestGame();
    const { queries } = rebuildListeners(state);
    const units = [
      unit(["Military"], { strength: 5 }),
      unit(["Knowledge"], { strength: 11 }),
    ];
    // military_1: 1 Military unit present ✓
    // strength_15: 5 + 11 = 16 ✓ (both units contribute)
    expect(checkMissionRequirements(reqs, units, state, queries)).toBe(true);
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
    const reqs = parseRequirements("knowledge_1;diplomacy_1");
    expect(checkMissionRequirements(reqs, [unit(["Knowledge"]), unit(["Diplomacy"])])).toBe(true);
    expect(checkMissionRequirements(reqs, [unit(["Knowledge"]), unit(["Knowledge"])])).toBe(false);
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

    const unparseable: string[] = [];
    const attributeNouns: string[] = [];
    for (const r of requirements) {
      try {
        const result = parseRequirements(r);
        expect(result.length).toBeGreaterThan(0);
        for (const req of result) {
          if (req.kind === "attribute") attributeNouns.push(req.attribute);
        }
      } catch {
        unparseable.push(r);
      }
    }

    // Every real requirement string must parse. `parseRequirements` now
    // rejects unknown attribute tokens, so an un-migrated role-noun
    // (e.g. `scientist_2`) lands here and fails the test loudly instead of
    // producing a silently-unwinnable mission.
    expect(unparseable).toEqual([]);

    // And every attribute referenced by a real mission must be governed.
    expect(attributeNouns.length).toBeGreaterThan(0);
    for (const noun of attributeNouns) {
      expect(isAttribute(noun)).toBe(true);
    }
  });
});
