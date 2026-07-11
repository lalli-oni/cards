import { describe, expect, it, mock } from "bun:test";
import { getVisibleEvent, type GameEvent } from "cards-engine";
import { categorizeEvent, describeEvent } from "../eventDescriptions";

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
        cell: (row, col) => (row === 2 && col === 1 ? "The Colosseum" : null),
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

    it("falls back to bare (row,col) when the cell resolver returns null (in-grid but unnamed)", () => {
      const event: GameEvent = {
        type: "combat_started",
        row: 0,
        col: 0,
        attackerId: "p1",
        defenderId: "p2",
      };

      const out = describeEvent(event, { cell: () => null });

      expect(out).toContain("(0,0)");
    });
  });

  describe("card_activated", () => {
    it("renders cardName directly without consulting the card resolver", () => {
      const cardResolver = mock((id: string) => `SHOULD_NOT_BE_CALLED_FOR_${id}`);
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Nefertiti",
        actionName: "inspire",
      };

      const out = describeEvent(event, {
        card: cardResolver,
        player: (id) => id,
      });

      expect(out).toContain("Nefertiti");
      expect(out).toContain("inspire");
      expect(out).not.toContain("inst-7");
      expect(cardResolver).not.toHaveBeenCalledWith("inst-7");
    });

    it("renders bare form when no target is provided", () => {
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Mansa Musa",
        actionName: "pilgrimage",
      };

      const out = describeEvent(event);

      expect(out).toBe("p1 used Mansa Musa (pilgrimage)");
    });

    it("appends ' on {target}' when a card target is set", () => {
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Galileo",
        actionName: "observe",
        target: { kind: "card", id: "opp-1" },
      };

      const out = describeEvent(event, {
        card: (id) => (id === "opp-1" ? "Opponent's Hand" : id),
      });

      expect(out).toContain("Galileo");
      expect(out).toContain("on Opponent's Hand");
    });

    it("appends ' at {cell}' when a cell target is set", () => {
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Genghis Khan",
        actionName: "conquer",
        target: { kind: "cell", row: 2, col: 3 },
      };

      const out = describeEvent(event, {
        cell: (row, col) =>
          row === 2 && col === 3 ? "Steppe" : null,
      });

      expect(out).toContain("Genghis Khan");
      expect(out).toContain("at Steppe (2,3)");
    });
  });

  describe("categorizeEvent", () => {
    it("returns 'player' when card_activated's playerId matches selfPlayerId", () => {
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Ada",
        actionName: "analyze",
      };

      expect(categorizeEvent(event, "p1")).toBe("player");
    });

    it("returns 'opponent' when card_activated's playerId differs from selfPlayerId", () => {
      const event: GameEvent = {
        type: "card_activated",
        playerId: "p1",
        cardId: "inst-7",
        cardName: "Ada",
        actionName: "analyze",
      };

      expect(categorizeEvent(event, "p2")).toBe("opponent");
    });

    it("routes combat_pair_resolved by attackerPlayerId — guards against the silent System-bucket regression", () => {
      const event: GameEvent = {
        type: "combat_pair_resolved",
        row: 0, col: 0,
        attackerPlayerId: "p1", defenderPlayerId: "p2",
        attacker: { unitId: "a", baseStrength: 5, modifiers: [], roll: 4, power: 9, injuredBefore: false },
        defender: { unitId: "b", baseStrength: 5, modifiers: [], roll: 4, power: 9, injuredBefore: false },
        outcome: "tie",
      };
      expect(categorizeEvent(event, "p1")).toBe("player");
      expect(categorizeEvent(event, "p2")).toBe("opponent");
    });

    it("routes contest_resolved by casterPlayerId — its attackerId is a UNIT id, not a player id", () => {
      const event: GameEvent = {
        type: "contest_resolved",
        stat: "charisma",
        casterPlayerId: "p1",
        attackerId: "unit-A", defenderId: "unit-B",
        attacker: { unitId: "unit-A", baseStat: 9, modifiers: [], roll: 4, power: 13 },
        defender: { unitId: "unit-B", baseStat: 4, modifiers: [], roll: 3, power: 7 },
        winnerId: "unit-A",
      };
      expect(categorizeEvent(event, "p1")).toBe("player");
      expect(categorizeEvent(event, "p2")).toBe("opponent");
    });

    it("routes combat_resolved by attackerId — keeps the winner line out of the hidden System bucket", () => {
      const event: GameEvent = {
        type: "combat_resolved",
        row: 0, col: 0,
        winnerId: "p2",
        attackerId: "p1", defenderId: "p2",
      };
      expect(categorizeEvent(event, "p1")).toBe("player");
      expect(categorizeEvent(event, "p2")).toBe("opponent");
    });
  });

  describe("card_drawn", () => {
    it("renders 'You drew {name}' when cardId is present (drawer view)", () => {
      const event: GameEvent = {
        type: "card_drawn",
        playerId: "p1",
        count: 1,
        cardId: "inst-42",
      };

      const out = describeEvent(event, {
        card: (id) => (id === "inst-42" ? "Cleopatra" : id),
        player: (id) => id,
      });

      expect(out).toBe("You drew Cleopatra");
    });

    it("renders 'P drew N card(s)' when cardId is absent (opponent view, post-scrub)", () => {
      // The engine emits cardId; `getVisibleEvent` strips it for non-drawer
      // viewers. Renderer must treat the absence as the opponent-view signal.
      const event: GameEvent = {
        type: "card_drawn",
        playerId: "p1",
        count: 1,
      };

      const out = describeEvent(event, {
        card: (id) => id,
        player: (id) => (id === "p1" ? "Alice" : id),
      });

      expect(out).toBe("Alice drew 1 card(s)");
    });
  });

  describe("card_drawn — full god-view → scrub → render contract", () => {
    // Integration-style: starting from the god-view event the engine emits,
    // run it through `getVisibleEvent` (the store's projection), then through
    // `describeEvent`. This pins the device-pass UX contract end-to-end —
    // the store wires `_visibleState.playerId` as the viewer; this test
    // pins what each viewer's projection should render. The store-level
    // re-derivation on viewer change is integration-tested via playtest
    // (no `gameStore.test.ts` — consistent with existing convention).
    const godViewEvent: GameEvent = {
      type: "card_drawn",
      playerId: "p1",
      count: 1,
      cardId: "inst-42",
    };
    const resolvers = {
      card: (id: string) => (id === "inst-42" ? "Cleopatra" : id),
      player: (id: string) => (id === "p1" ? "Alice" : id),
    };

    it("drawer-viewer sees 'You drew {name}'", () => {
      const projected = getVisibleEvent(godViewEvent, "p1");
      expect(describeEvent(projected, resolvers)).toBe("You drew Cleopatra");
    });

    it("opponent-viewer sees 'Alice drew 1 card(s)' — no leak of cardId, no misattribution", () => {
      const projected = getVisibleEvent(godViewEvent, "p2");
      expect(describeEvent(projected, resolvers)).toBe("Alice drew 1 card(s)");
    });
  });

  describe("card_bought", () => {
    it("renders cardName directly without consulting the card resolver", () => {
      const cardResolver = mock((id: string) => `SHOULD_NOT_BE_CALLED_FOR_${id}`);
      const event: GameEvent = {
        type: "card_bought",
        playerId: "p2",
        cardId: "inst-77",
        cardName: "Investment Banking",
        cost: 4,
      };

      const out = describeEvent(event, {
        card: cardResolver,
        player: (id) => (id === "p2" ? "Bob" : id),
      });

      expect(out).toBe("Bob bought Investment Banking for 4g");
      // Mirrors trap_triggered: cardId is unresolvable post-buy because the
      // card is now in the buyer's redacted hand. cardName must come off the
      // event, not the resolver.
      expect(cardResolver).not.toHaveBeenCalledWith("inst-77");
    });
  });

  describe("combat_pair_resolved", () => {
    it("renders base + modifier sources + roll = power per side, with outcome", () => {
      const event: GameEvent = {
        type: "combat_pair_resolved",
        row: 0,
        col: 0,
        attackerPlayerId: "p1",
        defenderPlayerId: "p2",
        attacker: {
          unitId: "atk-1",
          baseStrength: 5,
          modifiers: [
            { source: { type: "passive_event", cardId: "ar-1", definitionId: "arms-race" }, delta: 2 },
          ],
          roll: 4,
          power: 11,
          injuredBefore: false,
        },
        defender: {
          unitId: "def-1",
          baseStrength: 5,
          modifiers: [
            { source: { type: "passive_event", cardId: "pl-1", definitionId: "plague" }, delta: -2 },
          ],
          roll: 3,
          power: 6,
          injuredBefore: false,
        },
        outcome: "injure_defender",
      };

      const out = describeEvent(event, {
        card: (id) => (id === "atk-1" ? "Mansa Musa" : id === "def-1" ? "Genghis Khan" : id),
      });

      expect(out).toContain("Mansa Musa: 5 + 2 arms-race + 4🎲 = 11");
      expect(out).toContain("Genghis Khan: 5 − 2 plague + 3🎲 = 6");
      expect(out).toContain("Genghis Khan injured");
    });

    it("renders 'tie' outcome without a winner clause", () => {
      const event: GameEvent = {
        type: "combat_pair_resolved",
        row: 0, col: 0,
        attackerPlayerId: "p1", defenderPlayerId: "p2",
        attacker: { unitId: "a", baseStrength: 5, modifiers: [], roll: 4, power: 9, injuredBefore: false },
        defender: { unitId: "b", baseStrength: 5, modifiers: [], roll: 4, power: 9, injuredBefore: false },
        outcome: "tie",
      };
      const out = describeEvent(event);
      expect(out).toContain("tie");
    });
  });

  describe("contest_resolved (enriched)", () => {
    it("renders per-side breakdown when the new payload is present", () => {
      const event: GameEvent = {
        type: "contest_resolved",
        stat: "charisma",
        casterPlayerId: "p1",
        attackerId: "cleo",
        defenderId: "enemy",
        attacker: {
          unitId: "cleo",
          baseStat: 9,
          modifiers: [],
          roll: 4,
          power: 13,
        },
        defender: {
          unitId: "enemy",
          baseStat: 4,
          modifiers: [],
          roll: 3,
          power: 7,
        },
        winnerId: "cleo",
      };

      const out = describeEvent(event, {
        card: (id) => (id === "cleo" ? "Cleopatra" : id === "enemy" ? "Foe" : id),
      });

      expect(out).toContain("charisma contest");
      expect(out).toContain("Cleopatra: 9 + 4🎲 = 13");
      expect(out).toContain("Foe: 4 + 3🎲 = 7");
      expect(out).toContain("Cleopatra wins");
    });
  });
});
