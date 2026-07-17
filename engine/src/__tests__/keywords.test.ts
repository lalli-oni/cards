import { describe, expect, test } from "bun:test";
import { isKeyword, KeywordError, parseKeyword } from "../keywords";

describe("keyword vocabulary", () => {
  test("isKeyword recognizes governed names, case-sensitively", () => {
    expect(isKeyword("Berserker")).toBe(true);
    expect(isKeyword("Leader")).toBe(true);
    expect(isKeyword("berserker")).toBe(false);
    expect(isKeyword("Lethal")).toBe(false); // deferred candidate, not governed
  });

  describe("modifier families", () => {
    test("parses a full family token (with role)", () => {
      expect(parseKeyword("Prowess:+2:strength:combat:def", "unit")).toEqual({
        name: "Prowess",
        signedMagnitude: 2,
        statScope: "strength",
        context: "combat",
        role: "def",
      });
    });

    test("role is optional", () => {
      expect(parseKeyword("Leader:+1:all:combat", "unit")).toEqual({
        name: "Leader",
        signedMagnitude: 1,
        statScope: "all",
        context: "combat",
      });
    });

    test("negative magnitude (Aura debuff)", () => {
      expect(parseKeyword("Aura:-1:all:combat", "location").signedMagnitude).toBe(-1);
    });

    test("rejects an unsigned magnitude", () => {
      expect(() => parseKeyword("Leader:1:all:combat", "unit")).toThrow(KeywordError);
    });

    test("rejects a bad stat scope", () => {
      expect(() => parseKeyword("Leader:+1:power:combat", "unit")).toThrow(/stat must be/);
    });

    test("rejects a bad context", () => {
      expect(() => parseKeyword("Leader:+1:all:duel", "unit")).toThrow(/context must be/);
    });

    test("rejects too few params", () => {
      expect(() => parseKeyword("Leader:+1", "unit")).toThrow(/parameter/);
    });
  });

  describe("per-type scoping", () => {
    test("Aura is a location keyword, not supported on units", () => {
      expect(() => parseKeyword("Aura:-1:all:combat", "unit")).toThrow(/not supported on unit/);
      expect(parseKeyword("Aura:-1:all:combat", "location").name).toBe("Aura");
    });

    test("Flying is an equipment keyword, not supported on locations", () => {
      expect(() => parseKeyword("Flying", "location")).toThrow(/not supported on location/);
      expect(parseKeyword("Flying", "item").name).toBe("Flying");
    });
  });

  describe("standalone keywords", () => {
    test("Untouchable takes a specific stat, not `all`", () => {
      expect(parseKeyword("Untouchable:charisma", "unit")).toEqual({ name: "Untouchable", stat: "charisma" });
      expect(() => parseKeyword("Untouchable:all", "unit")).toThrow(KeywordError);
      expect(() => parseKeyword("Untouchable", "unit")).toThrow(/parameter/);
    });

    test("Patron takes a positive magnitude", () => {
      expect(parseKeyword("Patron:1", "unit")).toEqual({ name: "Patron", magnitude: 1 });
      expect(() => parseKeyword("Patron:0", "unit")).toThrow(/positive/);
      expect(() => parseKeyword("Patron:-1", "unit")).toThrow(KeywordError);
    });

    test("Squire's magnitude is optional", () => {
      expect(parseKeyword("Squire", "unit")).toEqual({ name: "Squire" });
      expect(parseKeyword("Squire:1", "unit")).toEqual({ name: "Squire", magnitude: 1 });
    });

    test("parameterless keywords reject extra args", () => {
      expect(parseKeyword("Berserker", "unit")).toEqual({ name: "Berserker" });
      expect(() => parseKeyword("Berserker:1", "unit")).toThrow(/parameter/);
    });

    test("unknown keyword throws", () => {
      expect(() => parseKeyword("Lethal", "unit")).toThrow(/unknown keyword/);
    });
  });
});
