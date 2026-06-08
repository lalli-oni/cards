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
});
