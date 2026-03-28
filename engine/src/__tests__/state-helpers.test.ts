import { describe, expect, it } from "bun:test";
import { getNextPlayerId, getTurnIndex } from "../state-helpers";

const threePlayers = {
  players: [
    { id: "p1" },
    { id: "p2" },
    { id: "p3" },
  ],
};

describe("getTurnIndex", () => {
  it("returns the index of a known player", () => {
    expect(getTurnIndex(threePlayers, "p1")).toBe(0);
    expect(getTurnIndex(threePlayers, "p2")).toBe(1);
    expect(getTurnIndex(threePlayers, "p3")).toBe(2);
  });

  it("throws for an unknown player", () => {
    expect(() => getTurnIndex(threePlayers, "unknown")).toThrow("not found");
  });
});

describe("getNextPlayerId", () => {
  it("returns the next player in order", () => {
    expect(getNextPlayerId(threePlayers, "p1")).toBe("p2");
    expect(getNextPlayerId(threePlayers, "p2")).toBe("p3");
  });

  it("wraps from last player to first", () => {
    expect(getNextPlayerId(threePlayers, "p3")).toBe("p1");
  });

  it("throws for an unknown player", () => {
    expect(() => getNextPlayerId(threePlayers, "unknown")).toThrow("not found");
  });
});
