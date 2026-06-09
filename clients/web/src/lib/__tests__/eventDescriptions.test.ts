import { describe, expect, it, mock } from "bun:test";
import type { GameEvent } from "cards-engine";
import { describeEvent } from "../eventDescriptions";

describe("describeEvent", () => {
  describe("trap_triggered", () => {
    it("renders cardName directly without consulting the card resolver", () => {
      const cardResolver = mock((id: string) => `SHOULD_NOT_BE_CALLED_FOR_${id}`);
      const event: GameEvent = {
        type: "trap_triggered",
        playerId: "p1",
        cardId: "inst-42",
        cardName: "Highway Robbery",
        targetId: "loc-7",
      };

      const out = describeEvent(event, {
        card: cardResolver,
        player: (id) => id,
      });

      expect(out).toContain("Highway Robbery");
      expect(out).not.toContain("inst-42");
      // The cardId path must not be resolved — that's the whole point of
      // carrying cardName inline (opponent traps are gone from VisibleState).
      expect(cardResolver).not.toHaveBeenCalledWith("inst-42");
    });

    it("still resolves targetId through the card resolver (target is a location, always visible)", () => {
      const cardResolver = mock((id: string) => (id === "loc-7" ? "The Pyramids" : id));
      const event: GameEvent = {
        type: "trap_triggered",
        playerId: "p1",
        cardId: "inst-42",
        cardName: "Ambush",
        targetId: "loc-7",
      };

      const out = describeEvent(event, { card: cardResolver });

      expect(out).toContain("Ambush");
      expect(out).toContain("The Pyramids");
      expect(cardResolver).toHaveBeenCalledWith("loc-7");
    });

    it("omits the target clause when targetId is absent", () => {
      const event: GameEvent = {
        type: "trap_triggered",
        playerId: "p1",
        cardId: "inst-42",
        cardName: "Untargeted Trap",
      };

      const out = describeEvent(event);

      expect(out).toBe("Untargeted Trap triggered");
    });
  });

  describe("cell rendering", () => {
    it("renders 'Location Name (row,col)' when the cell resolver returns a name", () => {
      const event: GameEvent = {
        type: "unit_entered",
        playerId: "p1",
        unitId: "u1",
        row: 2,
        col: 1,
      };

      const out = describeEvent(event, {
        cell: (row, col) => (row === 2 && col === 1 ? "The Colosseum" : undefined),
      });

      expect(out).toContain("The Colosseum (2,1)");
    });

    it("falls back to bare (row,col) when no cell resolver is provided", () => {
      const event: GameEvent = {
        type: "unit_entered",
        playerId: "p1",
        unitId: "u1",
        row: 2,
        col: 1,
      };

      const out = describeEvent(event);

      expect(out).toContain("(2,1)");
      expect(out).not.toContain("The Colosseum");
    });

    it("falls back to bare (row,col) when the cell resolver returns undefined", () => {
      const event: GameEvent = {
        type: "combat_started",
        row: 0,
        col: 0,
        attackerId: "p1",
        defenderId: "p2",
      };

      const out = describeEvent(event, { cell: () => undefined });

      expect(out).toContain("(0,0)");
    });
  });
});
