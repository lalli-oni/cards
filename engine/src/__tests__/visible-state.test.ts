import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { produce } from "immer";
import type { EndedGameState, GameEvent, MainGameState } from "../types";
import { getVisibleEvent, getVisibleEvents, getVisibleState } from "../visible-state";
import { UNIT_EFFECTS } from "../listeners/effects";
import {
  createSeedingGame,
  createTestGame,
  makeInstantEvent,
  makeItem,
  makeLocation,
  makePassiveEvent,
  makeTrapEvent,
  makeUnit,
  resetIds,
} from "./helpers";

describe("getVisibleState", () => {
  beforeEach(() => resetIds());

  it("throws for unknown player", () => {
    const state = createTestGame();
    expect(() => getVisibleState(state, "unknown")).toThrow("not found");
  });

  it("returns self as full PlayerState", () => {
    const state = createTestGame();
    const vis = getVisibleState(state, "p1");
    expect(vis.self.id).toBe("p1");
    expect(vis.playerId).toBe("p1");
  });

  it("populates currentPlayerId", () => {
    const state = createTestGame();
    const vis = getVisibleState(state, "p1");
    expect(vis.currentPlayerId).toBe(state.turn.activePlayerId);
  });

  describe("no teams (free-for-all)", () => {
    it("shows all other players as opponents", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(1);
      expect(vis.opponents[0].id).toBe("p2");
      expect(vis.teammates).toHaveLength(0);
    });
  });

  describe("with teams", () => {
    const teamPlayers = [
      { id: "p1", name: "Alice", team: "red" },
      { id: "p2", name: "Bob", team: "red" },
      { id: "p3", name: "Carol", team: "blue" },
    ];

    it("shows teammates with full visibility", () => {
      const state = createTestGame({ players: teamPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.teammates).toHaveLength(1);
      expect(vis.teammates[0].id).toBe("p2");
      // Teammates have full PlayerState (hand array, not handSize)
      expect(Array.isArray(vis.teammates[0].hand)).toBe(true);
    });

    it("shows non-teammates as opponents", () => {
      const state = createTestGame({ players: teamPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(1);
      expect(vis.opponents[0].id).toBe("p3");
    });

    it("teamless player sees everyone as opponent", () => {
      const mixedPlayers = [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob", team: "red" },
        { id: "p3", name: "Carol" },
      ];
      const state = createTestGame({ players: mixedPlayers });
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents).toHaveLength(2);
      expect(vis.teammates).toHaveLength(0);
    });
  });

  describe("opponent info hiding", () => {
    it("replaces hand with handSize", () => {
      const state = withCardsInHand(createTestGame(), "p2", 3);
      const vis = getVisibleState(state, "p1");
      expect(vis.opponents[0].handSize).toBe(3);
      expect("hand" in vis.opponents[0]).toBe(false);
    });

    it("replaces deck arrays with sizes", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      const opp = vis.opponents[0];
      expect(typeof opp.mainDeckSize).toBe("number");
      expect(typeof opp.marketDeckSize).toBe("number");
      expect(typeof opp.prospectDeckSize).toBe("number");
      expect(typeof opp.discardPileSize).toBe("number");
    });

    it("redacts trap card contents but always exposes cardId", () => {
      const state = withTrap(createTestGame(), "p2", "target-123");
      const vis = getVisibleState(state, "p1");
      const trap = vis.opponents[0].activeTraps[0];
      const p2 = state.players.find((p) => p.id === "p2")!;
      expect(trap.targetId).toBe("target-123");
      expect(trap.cardId).toBe(p2.activeTraps[0].card.id);
      expect(trap.card).toBeUndefined();
    });

    it("exposes opponent passive events (public effects like Plague / Arms Race)", () => {
      const state = produce(createTestGame(), (draft) => {
        const p2 = draft.players.find((p) => p.id === "p2")!;
        p2.passiveEvents.push({
          ...makePassiveEvent({ ownerId: "p2", definitionId: "plague", duration: 2 }),
          remainingDuration: 2,
          targetId: "loc-xyz",
        });
      });
      const vis = getVisibleState(state, "p1");
      const sourceP2 = state.players.find((p) => p.id === "p2")!;
      expect(vis.opponents[0].passiveEvents).toHaveLength(1);
      // Full pass-through: every field exposed, nothing redacted.
      expect(vis.opponents[0].passiveEvents[0]).toEqual(sourceP2.passiveEvents[0]);
    });

    it("opponent passive-event pass-through is uniform (Arms Race, not Plague-gated)", () => {
      const state = produce(createTestGame(), (draft) => {
        const p2 = draft.players.find((p) => p.id === "p2")!;
        p2.passiveEvents.push({
          ...makePassiveEvent({ ownerId: "p2", definitionId: "arms-race", duration: 2 }),
          remainingDuration: 2,
        });
      });
      const vis = getVisibleState(state, "p1");
      const sourceP2 = state.players.find((p) => p.id === "p2")!;
      expect(vis.opponents[0].passiveEvents[0]).toEqual(sourceP2.passiveEvents[0]);
    });

    it("combined opponent state: trap is redacted while passive event is fully visible", () => {
      const state = produce(createTestGame(), (draft) => {
        const p2 = draft.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "enemy_unit_enters_location" }),
          targetId: "loc-trap-target",
        });
        p2.passiveEvents.push({
          ...makePassiveEvent({ ownerId: "p2", definitionId: "plague", duration: 2 }),
          remainingDuration: 2,
          targetId: "loc-plague-target",
        });
      });
      const vis = getVisibleState(state, "p1");
      const opp = vis.opponents[0];

      // Trap: face-down — contents hidden, just target visible.
      expect(opp.activeTraps).toHaveLength(1);
      expect(opp.activeTraps[0].card).toBeUndefined();
      expect(opp.activeTraps[0].targetId).toBe("loc-trap-target");

      // Passive: face-up — full pass-through.
      expect(opp.passiveEvents).toHaveLength(1);
      expect(opp.passiveEvents[0].definitionId).toBe("plague");
      expect(opp.passiveEvents[0].targetId).toBe("loc-plague-target");
    });
  });

  describe("shared state", () => {
    it("includes grid for all players", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.grid).toBe(state.grid);
    });

    it("includes market for all players", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.market).toBe(state.market);
    });

    it("includes turn order", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.turnOrder).toEqual(state.players.map((p) => p.id));
    });

    it("includes turn for main phase", () => {
      const state = createTestGame();
      const vis = getVisibleState(state, "p1");
      expect(vis.turn).toBeDefined();
      expect(vis.turn?.activePlayerId).toBe(state.turn.activePlayerId);
    });
  });

  describe("seeding phase", () => {
    it("has turn undefined during seeding", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.turn).toBeUndefined();
    });

    it("populates currentPlayerId from seedingState", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.currentPlayerId).toBe(state.seedingState.currentPlayerId);
    });

    it("includes seedingStep", () => {
      const state = createSeedingGame();
      const vis = getVisibleState(state, state.seedingState.currentPlayerId);
      expect(vis.seedingStep).toBe("seed_draw");
    });
  });

  describe("ended phase", () => {
    it("does not throw for ended game", () => {
      const base = createTestGame();
      const endedState: EndedGameState = {
        ...base,
        phase: "ended",
        scores: {},
        pickPrompt: undefined,
        viewPrompt: undefined,
      };
      const vis = getVisibleState(endedState, "p1");
      expect(vis.phase).toBe("ended");
      expect(vis.currentPlayerId).toBe(base.turn.activePlayerId);
    });
  });

  describe("reveals — Alexandria Harbor", () => {
    it("exposes top of own main deck to the owner", () => {
      const state = produce(createTestGame(), (d) => {
        const p1 = d.players.find((p) => p.id === "p1")!;
        p1.mainDeck.unshift(makeInstantEvent({ ownerId: "p1" }));
        d.grid[0][0].location = makeLocation({
          ownerId: "p1",
          definitionId: "alexandria-harbor",
        });
      });
      const vis = getVisibleState(state, "p1");
      const p1Deck = state.players.find((p) => p.id === "p1")!.mainDeck;
      expect(vis.reveals.mainDeckTop).toBeDefined();
      expect(vis.reveals.mainDeckTop!.id).toBe(p1Deck[0].id);
    });

    it("does not expose top of deck to non-owners", () => {
      const state = produce(createTestGame(), (d) => {
        const p1 = d.players.find((p) => p.id === "p1")!;
        p1.mainDeck.unshift(makeInstantEvent({ ownerId: "p1" }));
        d.grid[0][0].location = makeLocation({
          ownerId: "p1",
          definitionId: "alexandria-harbor",
        });
      });
      const vis = getVisibleState(state, "p2");
      expect(vis.reveals.mainDeckTop).toBeUndefined();
    });

    it("does not expose when deck is empty", () => {
      const state = produce(createTestGame(), (d) => {
        d.grid[0][0].location = makeLocation({
          ownerId: "p1",
          definitionId: "alexandria-harbor",
        });
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.mainDeckTop).toBeUndefined();
    });
  });

  describe("reveals — Spy Glass", () => {
    it("un-redacts opponent traps at the equipped unit's location", () => {
      const state = produce(createTestGame(), (d) => {
        const loc = makeLocation({ ownerId: "p1" });
        d.grid[0][0].location = loc;
        const unit = makeUnit({ ownerId: "p1" });
        d.grid[0][0].units.push(unit);
        d.grid[0][0].items.push(
          makeItem({ ownerId: "p1", definitionId: "spy-glass", equippedTo: unit.id }),
        );
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: loc.id,
        });
      });
      const vis = getVisibleState(state, "p1");
      const opp = vis.opponents.find((o) => o.id === "p2")!;
      expect(opp.activeTraps).toHaveLength(1);
      expect(opp.activeTraps[0].card).toBeDefined();
      expect(opp.activeTraps[0].cardId).toBe(opp.activeTraps[0].card!.id);
    });

    it("keeps opponent traps redacted when Spy Glass is not at the trap's location", () => {
      const state = produce(createTestGame(), (d) => {
        const targetLoc = makeLocation({ ownerId: "p1" });
        const otherLoc = makeLocation({ ownerId: "p1" });
        d.grid[0][0].location = targetLoc;
        d.grid[0][1].location = otherLoc;
        const unit = makeUnit({ ownerId: "p1" });
        d.grid[0][1].units.push(unit);
        d.grid[0][1].items.push(
          makeItem({ ownerId: "p1", definitionId: "spy-glass", equippedTo: unit.id }),
        );
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: targetLoc.id,
        });
      });
      const vis = getVisibleState(state, "p1");
      const opp = vis.opponents.find((o) => o.id === "p2")!;
      expect(opp.activeTraps[0].card).toBeUndefined();
    });

    it("does not fire when Spy Glass is stored in HQ (not on grid)", () => {
      const state = produce(createTestGame(), (d) => {
        const loc = makeLocation({ ownerId: "p1" });
        d.grid[0][0].location = loc;
        const p1 = d.players.find((p) => p.id === "p1")!;
        p1.hq.push(makeItem({ ownerId: "p1", definitionId: "spy-glass" }));
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: loc.id,
        });
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.revealedTrapIds).toHaveLength(0);
    });

    it("does not fire when equipped unit is on a cell with no location", () => {
      const state = produce(createTestGame(), (d) => {
        const unit = makeUnit({ ownerId: "p1" });
        // No location on (0,0)
        d.grid[0][0].units.push(unit);
        d.grid[0][0].items.push(
          makeItem({ ownerId: "p1", definitionId: "spy-glass", equippedTo: unit.id }),
        );
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: "any",
        });
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.revealedTrapIds).toHaveLength(0);
    });

    it("does not fire when Spy Glass is on grid but not equipped to any unit", () => {
      const state = produce(createTestGame(), (d) => {
        const loc = makeLocation({ ownerId: "p1" });
        d.grid[0][0].location = loc;
        // Spy Glass on cell with no equippedTo
        d.grid[0][0].items.push(
          makeItem({ ownerId: "p1", definitionId: "spy-glass" }),
        );
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: loc.id,
        });
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.revealedTrapIds).toHaveLength(0);
    });

    it("does not surface trap reveal rights to the wrong viewer", () => {
      const state = produce(createTestGame(), (d) => {
        const loc = makeLocation({ ownerId: "p1" });
        d.grid[0][0].location = loc;
        const unit = makeUnit({ ownerId: "p1" });
        d.grid[0][0].units.push(unit);
        d.grid[0][0].items.push(
          makeItem({ ownerId: "p1", definitionId: "spy-glass", equippedTo: unit.id }),
        );
        const p2 = d.players.find((p) => p.id === "p2")!;
        p2.activeTraps.push({
          card: makeTrapEvent({ ownerId: "p2", trigger: "test" }),
          targetId: loc.id,
        });
      });
      // Spy Glass belongs to p1 — viewing as p2 should not grant trap reveals.
      const visP2 = getVisibleState(state, "p2");
      expect(visP2.reveals.revealedTrapIds).toHaveLength(0);
    });
  });

  describe("reveals — UNIT_EFFECTS factory branches in computeReveals", () => {
    // Register a fixture-only unit definitionId with a reveals provider so
    // both the grid and HQ walker branches in computeReveals get exercised
    // beyond the cards that ship with reveals today.
    const STUB_DEF = "__reveals-test-unit__";
    let stubInvocations: { viewerId: string; hasPosition: boolean }[] = [];

    beforeEach(() => {
      stubInvocations = [];
      UNIT_EFFECTS[STUB_DEF] = (_unit, ownerId, position) => ({
        listeners: [],
        queries: [],
        reveals: (_state, viewerId) => {
          stubInvocations.push({ viewerId, hasPosition: position != null });
          return viewerId === ownerId ? { revealedTrapIds: [`stub-${ownerId}`] } : {};
        },
      });
    });

    afterEach(() => {
      delete UNIT_EFFECTS[STUB_DEF];
    });

    it("invokes a unit's reveals provider for grid-deployed units (with position)", () => {
      const state = produce(createTestGame(), (d) => {
        d.grid[1][1].units.push(makeUnit({ ownerId: "p1", definitionId: STUB_DEF }));
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.revealedTrapIds).toContain("stub-p1");
      expect(stubInvocations.some((c) => c.hasPosition)).toBe(true);
    });

    it("invokes a unit's reveals provider for HQ-stored units (no position)", () => {
      const state = produce(createTestGame(), (d) => {
        const p1 = d.players.find((p) => p.id === "p1")!;
        p1.hq.push(makeUnit({ ownerId: "p1", definitionId: STUB_DEF }));
      });
      const vis = getVisibleState(state, "p1");
      expect(vis.reveals.revealedTrapIds).toContain("stub-p1");
      expect(stubInvocations.some((c) => !c.hasPosition)).toBe(true);
    });
  });
});

// ---- Helpers to set up specific state for tests ----

function withCardsInHand(
  state: MainGameState,
  playerId: string,
  count: number,
): MainGameState {
  return produce(state, (draft) => {
    // biome-ignore lint/style/noNonNullAssertion: test helper with known player IDs
    const player = draft.players.find((p) => p.id === playerId)!;
    for (let i = 0; i < count; i++) {
      player.hand.push(makeUnit({ ownerId: playerId }));
    }
  });
}

function withTrap(
  state: MainGameState,
  playerId: string,
  targetId: string,
): MainGameState {
  return produce(state, (draft) => {
    // biome-ignore lint/style/noNonNullAssertion: test helper with known player IDs
    const player = draft.players.find((p) => p.id === playerId)!;
    player.activeTraps.push({
      card: makeTrapEvent({ ownerId: playerId, trigger: "test" }),
      targetId,
    });
  });
}

// ---------------------------------------------------------------------------
// getVisibleEvent — per-viewer event scrubbing
// ---------------------------------------------------------------------------

describe("getVisibleEvent", () => {
  it("preserves cardId on card_drawn when the viewer is the drawer", () => {
    const event: GameEvent = {
      type: "card_drawn",
      playerId: "p1",
      count: 1,
      cardId: "inst-42",
    };
    const result = getVisibleEvent(event, "p1");
    expect(result).toEqual(event);
  });

  it("strips cardId from card_drawn when the viewer is not the drawer", () => {
    const event: GameEvent = {
      type: "card_drawn",
      playerId: "p1",
      count: 1,
      cardId: "inst-42",
    };
    const result = getVisibleEvent(event, "p2");
    expect(result).toEqual({ type: "card_drawn", playerId: "p1", count: 1 });
    // Cross-check: cardId must not survive the scrub via any code path —
    // a future refactor that spreads the original event would silently leak.
    expect("cardId" in result).toBe(false);
    // Defensive: original input must not be mutated.
    expect(event.cardId).toBe("inst-42");
  });

  it("is a no-op for card_bought (public event with cardName)", () => {
    const event: GameEvent = {
      type: "card_bought",
      playerId: "p1",
      cardId: "inst-77",
      cardName: "Investment Banking",
      cost: 4,
    };
    expect(getVisibleEvent(event, "p1")).toBe(event);
    expect(getVisibleEvent(event, "p2")).toBe(event);
  });

  it("is a no-op for unrelated event types regardless of viewer", () => {
    const event: GameEvent = { type: "turn_started", playerId: "p1", round: 3 };
    expect(getVisibleEvent(event, "p1")).toBe(event);
    expect(getVisibleEvent(event, "p2")).toBe(event);
  });
});

describe("getVisibleEvents", () => {
  it("projects each event through the per-viewer scrub", () => {
    const events: GameEvent[] = [
      { type: "turn_started", playerId: "p1", round: 3 },
      { type: "card_drawn", playerId: "p1", count: 1, cardId: "inst-42" },
      { type: "card_drawn", playerId: "p2", count: 1, cardId: "inst-99" },
    ];
    const fromP2 = getVisibleEvents(events, "p2");
    expect(fromP2).toEqual([
      { type: "turn_started", playerId: "p1", round: 3 },
      { type: "card_drawn", playerId: "p1", count: 1 }, // p1's draw — cardId stripped
      { type: "card_drawn", playerId: "p2", count: 1, cardId: "inst-99" }, // p2's own draw
    ]);
  });
});
