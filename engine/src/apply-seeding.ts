import type { Draft } from "immer";
import { produce } from "immer";
import prand from "pure-rand";
import { runStartOfTurn } from "./apply-main";
import { extractRngState, shuffle } from "./rng";
import { isFull } from "./grid-helpers";
import {
  advanceSeedingCursor,
  getConfigNumber,
  getPlayer,
  placeLocationOnGrid,
} from "./state-helpers";
import type {
  ApplyResult,
  Card,
  GameEvent,
  LocationCard,
  MainGameState,
  PolicyCard,
  SeedingAction,
  SeedingGameState,
  SeedingState,
} from "./types";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that ID arrays have no duplicates and no overlap between them. */
function validateUniqueIds(label: string, ...arrays: string[][]): void {
  const seen = new Set<string>();
  for (const arr of arrays) {
    for (const id of arr) {
      if (seen.has(id)) {
        throw new Error(`Duplicate ID "${id}" in ${label}`);
      }
      seen.add(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applySeedingAction(
  state: SeedingGameState,
  action: SeedingAction,
): ApplyResult {
  // policy_select triggers a phase transition — handled separately
  // so we can construct MainGameState explicitly with full type checking.
  if (action.type === "policy_select") {
    return handlePolicySelection(state, action);
  }

  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    const ds = draft.seedingState;
    draft.actionLog.push(action);

    switch (action.type) {
      case "seed_draw":
        handleSeedDraw(draft, ds, action.playerId, events);
        break;
      case "seed_keep":
        handleSeedKeep(
          draft,
          ds,
          action.playerId,
          action.keepIds,
          action.exposeIds,
          events,
        );
        break;
      case "seed_steal":
        handleSeedSteal(
          draft,
          ds,
          action.playerId,
          action.cardId,
          action.row,
          action.col,
          action.rotation,
          events,
        );
        break;
      case "seed_place_location":
        handleSeedPlaceLocation(
          draft,
          ds,
          action.playerId,
          action.row,
          action.col,
          action.rotation,
          events,
        );
        break;
    }
  });

  return { state: nextState, events };
}

// -- seed_draw ---------------------------------------------------------------

function handleSeedDraw(
  draft: Draft<SeedingGameState>,
  seeding: Draft<SeedingState>,
  playerId: string,
  events: GameEvent[],
): void {
  if (seeding.step !== "seed_draw") {
    throw new Error(`seed_draw not valid during step "${seeding.step}"`);
  }

  const player = getPlayer(draft, playerId);
  if (player.seedingDeck.length === 0) {
    throw new Error(
      `Player "${playerId}" has no cards left in seeding deck during seed_draw`,
    );
  }
  const drawCount = getConfigNumber(draft, "seed_draw", 10);
  const actual = Math.min(drawCount, player.seedingDeck.length);
  const drawn = player.seedingDeck.splice(0, actual);
  player.hand.push(...drawn);

  events.push({ type: "seed_cards_drawn", playerId, count: actual });

  advanceSeedingCursor(draft, events);

  // If we've looped back to the first player, all have drawn
  if (seeding.currentPlayerId === draft.turnOrder[0]) {
    seeding.step = "seed_keep";
    seeding.keepSubmitted = [];
    events.push({ type: "seeding_step_changed", step: "seed_keep" });
  }
}

// -- seed_keep ---------------------------------------------------------------

function handleSeedKeep(
  draft: Draft<SeedingGameState>,
  seeding: Draft<SeedingState>,
  playerId: string,
  keepIds: string[],
  exposeIds: string[],
  events: GameEvent[],
): void {
  if (seeding.step !== "seed_keep") {
    throw new Error(`seed_keep not valid during step "${seeding.step}"`);
  }

  validateUniqueIds("keep/expose", keepIds, exposeIds);

  const player = getPlayer(draft, playerId);
  const keepCount = getConfigNumber(draft, "seed_keep", 8);
  const exposeCount = getConfigNumber(draft, "seed_expose", 2);

  // Handle proportional split when fewer cards were drawn
  const totalInHand = player.hand.length;
  if (totalInHand < keepCount + exposeCount) {
    const adjustedKeep = Math.ceil(
      totalInHand * (keepCount / (keepCount + exposeCount)),
    );
    const adjustedExpose = totalInHand - adjustedKeep;
    if (
      keepIds.length !== adjustedKeep ||
      exposeIds.length !== adjustedExpose
    ) {
      throw new Error(
        `With ${totalInHand} cards in hand, expected ${adjustedKeep} keep + ${adjustedExpose} expose, ` +
          `got ${keepIds.length} keep + ${exposeIds.length} expose`,
      );
    }
  } else if (keepIds.length !== keepCount || exposeIds.length !== exposeCount) {
    throw new Error(
      `Expected ${keepCount} keep + ${exposeCount} expose, got ${keepIds.length} keep + ${exposeIds.length} expose`,
    );
  }

  // Validate all IDs are in hand
  const allIds = [...keepIds, ...exposeIds];
  for (const id of allIds) {
    if (!player.hand.some((c) => c.id === id)) {
      throw new Error(`Card "${id}" not in player "${playerId}"'s hand`);
    }
  }

  // Move kept cards: locations → prospect deck, others → market deck
  // TODO: when dilemma card type is added, route dilemmas to prospect deck too
  let toProspect = 0;
  let toMarket = 0;
  for (const id of keepIds) {
    const idx = player.hand.findIndex((c) => c.id === id);
    const card = player.hand.splice(idx, 1)[0];
    if (card.type === "location") {
      player.prospectDeck.push(card);
      toProspect++;
    } else {
      player.marketDeck.push(card);
      toMarket++;
    }
  }

  // Move exposed cards to middle area
  for (const id of exposeIds) {
    const idx = player.hand.findIndex((c) => c.id === id);
    seeding.middleArea.push(player.hand.splice(idx, 1)[0]);
  }

  events.push({
    type: "seed_kept",
    playerId,
    keptCount: keepIds.length,
    exposedCount: exposeIds.length,
    toProspect,
    toMarket,
  });

  seeding.keepSubmitted.push(playerId);
  advanceSeedingCursor(draft, events);

  // After all players have kept, transition to steal
  if (seeding.keepSubmitted.length === draft.players.length) {
    seeding.step = "seed_steal";
    seeding.stealTurnIndex = 0;
    seeding.currentPlayerId = draft.turnOrder[0];
    events.push({ type: "seeding_step_changed", step: "seed_steal" });
  }
}

// -- seed_steal --------------------------------------------------------------

function handleSeedSteal(
  draft: Draft<SeedingGameState>,
  seeding: Draft<SeedingState>,
  playerId: string,
  cardId: string,
  row: number | undefined,
  col: number | undefined,
  rotation: number | undefined,
  events: GameEvent[],
): void {
  if (seeding.step !== "seed_steal") {
    throw new Error(`seed_steal not valid during step "${seeding.step}"`);
  }

  const cardIdx = seeding.middleArea.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error(`Card "${cardId}" not found in middle area`);
  }

  const card = seeding.middleArea.splice(cardIdx, 1)[0];
  const player = getPlayer(draft, playerId);

  let destination: "grid" | "prospect" | "market";
  if (card.type === "location" && !isFull(draft.grid)) {
    if (row == null || col == null) {
      throw new Error(
        "Stolen location requires row and col for grid placement",
      );
    }
    placeLocationOnGrid(draft, card as LocationCard, row, col, rotation);
    events.push({ type: "location_placed", row, col, cardId: card.id });
    destination = "grid";
  } else if (card.type === "location") {
    player.prospectDeck.push(card);
    destination = "prospect";
  } else {
    player.marketDeck.push(card);
    destination = "market";
  }

  events.push({ type: "seed_stolen", playerId, cardId: card.id, destination });

  // Advance steal turn
  seeding.stealTurnIndex =
    (seeding.stealTurnIndex + 1) % draft.turnOrder.length;
  seeding.currentPlayerId = draft.turnOrder[seeding.stealTurnIndex];

  // If middle area is empty, determine next step
  if (seeding.middleArea.length === 0) {
    const anyDeckHasCards = draft.players.some((p) => p.seedingDeck.length > 0);
    if (anyDeckHasCards) {
      seeding.step = "seed_draw";
      seeding.currentPlayerId = draft.turnOrder[0];
      events.push({ type: "seeding_step_changed", step: "seed_draw" });
    } else {
      // Auto-shuffle prospect decks and build main decks
      let rng = prand.mersenne.fromState(draft.rngState);
      for (const player of draft.players) {
        const [shuffled, nextRng] = shuffle(player.prospectDeck, rng);
        player.prospectDeck = shuffled;
        rng = nextRng;
        events.push({ type: "prospect_deck_built", playerId: player.id });
        events.push({
          type: "deck_shuffled",
          playerId: player.id,
          deck: "prospect",
        });
      }

      rng = buildMainDecksAndHands(draft, rng, events);
      draft.rngState = extractRngState(rng) as number[];

      const nextStep = isFull(draft.grid)
        ? "policy_selection"
        : "seed_place_location";
      seeding.step = nextStep;
      seeding.currentPlayerId = draft.turnOrder[0];
      events.push({ type: "seeding_step_changed", step: nextStep });
    }
  }
}

/** After seeding is complete: shuffle market deck, draw main deck, draw starting hand. */
function buildMainDecksAndHands(
  draft: Draft<SeedingGameState>,
  rng: prand.RandomGenerator,
  events: GameEvent[],
): prand.RandomGenerator {
  const mainDeckDraw = getConfigNumber(draft, "seed_main_deck_draw", 15);
  const startingHandSize = getConfigNumber(draft, "starting_hand_size", 5);

  for (const player of draft.players) {
    let shuffled: Card[];
    [shuffled, rng] = shuffle(player.marketDeck, rng);
    player.marketDeck = shuffled;
    events.push({ type: "deck_shuffled", playerId: player.id, deck: "market" });

    const drawCount = Math.min(mainDeckDraw, player.marketDeck.length);
    player.mainDeck = player.marketDeck.splice(0, drawCount);

    [shuffled, rng] = shuffle(player.mainDeck, rng);
    player.mainDeck = shuffled;
    events.push({ type: "deck_shuffled", playerId: player.id, deck: "main" });

    const handCount = Math.min(startingHandSize, player.mainDeck.length);
    player.hand.push(...player.mainDeck.splice(0, handCount));

    events.push({ type: "deck_constructed", playerId: player.id });
  }

  return rng;
}

// -- seed_place_location -----------------------------------------------------

function handleSeedPlaceLocation(
  draft: Draft<SeedingGameState>,
  seeding: Draft<SeedingState>,
  playerId: string,
  row: number,
  col: number,
  rotation: number | undefined,
  events: GameEvent[],
): void {
  if (seeding.step !== "seed_place_location") {
    throw new Error(
      `seed_place_location not valid during step "${seeding.step}"`,
    );
  }

  const player = getPlayer(draft, playerId);

  // Draw from top of prospect deck until we get a location
  let card = player.prospectDeck.shift();
  while (card && card.type !== "location") {
    player.hand.push(card);
    card = player.prospectDeck.shift();
  }

  if (!card) {
    // No locations left — skip this player
    advanceSeedingCursor(draft, events);
    if (isFull(draft.grid)) {
      seeding.step = "policy_selection";
      seeding.currentPlayerId = draft.turnOrder[0];
      events.push({ type: "seeding_step_changed", step: "policy_selection" });
    }
    return;
  }

  placeLocationOnGrid(draft, card as LocationCard, row, col, rotation);
  events.push({ type: "location_placed", row, col, cardId: card.id });

  advanceSeedingCursor(draft, events);

  if (isFull(draft.grid)) {
    seeding.step = "policy_selection";
    seeding.currentPlayerId = draft.turnOrder[0];
    events.push({ type: "seeding_step_changed", step: "policy_selection" });
  }
}

// -- policy_selection (random assignment placeholder) -------------------------
// TODO(#29): Replace with policy selection draft mechanic

function handlePolicySelection(
  state: SeedingGameState,
  action: SeedingAction,
): ApplyResult {
  if (state.seedingState.step !== "policy_selection") {
    throw new Error(
      `policy_select not valid during step "${state.seedingState.step}"`,
    );
  }

  const events: GameEvent[] = [];

  // Step 1: Apply policy assignment within seeding state (Immer)
  const final = produce(state, (draft) => {
    draft.actionLog.push(action);

    let rng = prand.mersenne.fromState(draft.rngState);

    for (const player of draft.players) {
      if (player.policyPool.length < 2) {
        throw new Error(
          `Player "${player.id}" has ${player.policyPool.length} policies in pool, need at least 2`,
        );
      }

      let shuffled: PolicyCard[];
      [shuffled, rng] = shuffle(player.policyPool, rng);
      player.activePolicies.push(shuffled[0], shuffled[1]);
      player.policyPool = shuffled.slice(2);

      events.push({
        type: "policies_assigned",
        playerId: player.id,
        policyIds: player.activePolicies.map((pol) => pol.id),
      });
    }

    draft.rngState = extractRngState(rng) as number[];
  });

  // Step 2: Construct MainGameState explicitly (full type checking)
  const mainState: MainGameState = {
    config: final.config,
    phase: "main",
    turn: {
      activePlayerId: final.turnOrder[0],
      round: 1,
      actionPointsRemaining: getConfigNumber(
        final,
        "action_points_per_turn",
        3,
      ),
    },
    players: final.players,
    grid: final.grid,
    market: final.market,
    rngState: final.rngState,
    seed: final.seed,
    actionLog: final.actionLog,
    turnOrder: final.turnOrder,
  };

  events.push({ type: "phase_changed", from: "seeding", to: "main" });
  events.push({
    type: "turn_started",
    playerId: final.turnOrder[0],
    round: 1,
  });

  // Run first player's start-of-turn (gold income, card draw, market population)
  const readyState = produce(mainState, (draft) => {
    runStartOfTurn(draft, events);
  });

  return { state: readyState, events };
}
