import { produce } from "immer";
import prand from "pure-rand";
import { extractRngState, shuffle } from "./rng";
import {
  advanceTurn,
  getConfigNumber,
  getPlayer,
  placeLocationOnGrid,
} from "./state-helpers";
import type {
  ApplyResult,
  Card,
  GameEvent,
  GameState,
  LocationCard,
  PolicyCard,
  SeedingAction,
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
  state: GameState,
  action: SeedingAction,
): ApplyResult {
  const events: GameEvent[] = [];

  const nextState = produce(state, (draft) => {
    // biome-ignore lint/style/noNonNullAssertion: seedingState validated by applyAction router (#54)
    const ds = draft.seedingState!;
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
      case "seed_split_prospect":
        handleSeedSplitProspect(
          draft,
          ds,
          action.playerId,
          action.topHalf,
          action.bottomHalf,
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
      case "policy_select":
        handlePolicySelection(draft, ds, events);
        break;
    }
  });

  return { state: nextState, events };
}

// -- seed_draw ---------------------------------------------------------------

function handleSeedDraw(
  draft: GameState,
  seeding: SeedingState,
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

  advanceTurn(draft, events);

  // If we've looped back to the first player, all have drawn
  if (draft.turn.activePlayerId === draft.turnOrder[0]) {
    seeding.step = "seed_keep";
    seeding.keepSubmitted = [];
    events.push({ type: "seeding_step_changed", step: "seed_keep" });
  }
}

// -- seed_keep ---------------------------------------------------------------

function handleSeedKeep(
  draft: GameState,
  seeding: SeedingState,
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

  // Move kept cards to market deck
  for (const id of keepIds) {
    const idx = player.hand.findIndex((c) => c.id === id);
    player.marketDeck.push(player.hand.splice(idx, 1)[0]);
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
  });

  seeding.keepSubmitted.push(playerId);
  advanceTurn(draft, events);

  // After all players have kept, transition to steal
  if (seeding.keepSubmitted.length === draft.players.length) {
    seeding.step = "seed_steal";
    seeding.stealTurnIndex = 0;
    draft.turn.activePlayerId = draft.turnOrder[0];
    events.push({ type: "seeding_step_changed", step: "seed_steal" });
  }
}

// -- seed_steal --------------------------------------------------------------

function handleSeedSteal(
  draft: GameState,
  seeding: SeedingState,
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

  if (card.type === "location") {
    if (row == null || col == null) {
      throw new Error(
        "Stolen location requires row and col for grid placement",
      );
    }
    placeLocationOnGrid(draft, card as LocationCard, row, col, rotation);
    events.push({ type: "location_placed", row, col, cardId: card.id });
  } else {
    player.marketDeck.push(card);
  }

  events.push({ type: "seed_stolen", playerId, cardId: card.id });

  // Advance steal turn
  seeding.stealTurnIndex =
    (seeding.stealTurnIndex + 1) % draft.turnOrder.length;
  draft.turn.activePlayerId = draft.turnOrder[seeding.stealTurnIndex];

  // If middle area is empty, determine next step
  if (seeding.middleArea.length === 0) {
    const anyDeckHasCards = draft.players.some((p) => p.seedingDeck.length > 0);
    if (anyDeckHasCards) {
      seeding.step = "seed_draw";
      draft.turn.activePlayerId = draft.turnOrder[0];
      events.push({ type: "seeding_step_changed", step: "seed_draw" });
    } else {
      seeding.step = "seed_split_prospect";
      seeding.splitSubmitted = [];
      draft.turn.activePlayerId = draft.turnOrder[0];
      events.push({
        type: "seeding_step_changed",
        step: "seed_split_prospect",
      });
    }
  }
}

// -- seed_split_prospect -----------------------------------------------------

function handleSeedSplitProspect(
  draft: GameState,
  seeding: SeedingState,
  playerId: string,
  topHalf: string[],
  bottomHalf: string[],
  events: GameEvent[],
): void {
  if (seeding.step !== "seed_split_prospect") {
    throw new Error(
      `seed_split_prospect not valid during step "${seeding.step}"`,
    );
  }

  validateUniqueIds("prospect split", topHalf, bottomHalf);

  const player = getPlayer(draft, playerId);

  // Extract locations from market deck
  const locationIds = new Set([...topHalf, ...bottomHalf]);
  const locations: LocationCard[] = [];
  const remaining: Card[] = [];

  for (const card of player.marketDeck) {
    if (locationIds.has(card.id)) {
      if (card.type !== "location") {
        throw new Error(`Card "${card.id}" is not a location`);
      }
      locations.push(card as LocationCard);
    } else {
      remaining.push(card);
    }
  }

  if (locations.length !== locationIds.size) {
    const found = new Set(locations.map((l) => l.id));
    const missing = [...locationIds].filter((id) => !found.has(id));
    throw new Error(
      `Location IDs not found in market deck: ${missing.join(", ")}`,
    );
  }

  const marketLocations = player.marketDeck.filter(
    (c) => c.type === "location",
  );
  if (marketLocations.length !== locations.length) {
    throw new Error(
      `All ${marketLocations.length} locations in market deck must be split, but only ${locations.length} were provided`,
    );
  }

  // Build prospect deck: shuffle each half, stack top on bottom
  let rng = prand.mersenne.fromState(draft.rngState);

  // biome-ignore lint/style/noNonNullAssertion: IDs validated by validateUniqueIds + locationIds check above
  const getLocation = (id: string) => locations.find((l) => l.id === id)!;
  const topCards = topHalf.map(getLocation);
  const bottomCards = bottomHalf.map(getLocation);

  const [shuffledTop, rng2] = shuffle(topCards, rng);
  const [shuffledBottom, rng3] = shuffle(bottomCards, rng2);
  rng = rng3;

  player.prospectDeck = [...shuffledTop, ...shuffledBottom];
  player.marketDeck = remaining;

  draft.rngState = extractRngState(rng);

  events.push({ type: "prospect_deck_built", playerId });
  events.push({ type: "deck_shuffled", playerId, deck: "prospect" });

  seeding.splitSubmitted.push(playerId);
  advanceTurn(draft, events);

  // After all players submit, do automatic deck construction
  if (seeding.splitSubmitted.length === draft.players.length) {
    rng = prand.mersenne.fromState(draft.rngState);
    rng = buildMainDecksAndHands(draft, rng, events);
    draft.rngState = extractRngState(rng);

    const hasEmptyCells = draft.grid.some((row) =>
      row.some((cell) => cell.location === null),
    );
    if (hasEmptyCells) {
      seeding.step = "seed_place_location";
      draft.turn.activePlayerId = draft.turnOrder[0];
      events.push({
        type: "seeding_step_changed",
        step: "seed_place_location",
      });
    } else {
      seeding.step = "policy_selection";
      draft.turn.activePlayerId = draft.turnOrder[0];
      events.push({ type: "seeding_step_changed", step: "policy_selection" });
    }
  }
}

/** After all prospect splits: shuffle market deck, draw main deck, draw starting hand. */
function buildMainDecksAndHands(
  draft: GameState,
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
  draft: GameState,
  seeding: SeedingState,
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
    throw new Error(
      `Player "${playerId}" has no locations left in prospect deck`,
    );
  }

  placeLocationOnGrid(draft, card as LocationCard, row, col, rotation);
  events.push({ type: "location_placed", row, col, cardId: card.id });

  advanceTurn(draft, events);

  const hasEmptyCells = draft.grid.some((r) =>
    r.some((cell) => cell.location === null),
  );
  if (!hasEmptyCells) {
    seeding.step = "policy_selection";
    draft.turn.activePlayerId = draft.turnOrder[0];
    events.push({ type: "seeding_step_changed", step: "policy_selection" });
  }
}

// -- policy_selection (random assignment placeholder) -------------------------
// TODO(#29): Replace with policy selection draft mechanic

function handlePolicySelection(
  draft: GameState,
  seeding: SeedingState,
  events: GameEvent[],
): void {
  if (seeding.step !== "policy_selection") {
    throw new Error(`policy_select not valid during step "${seeding.step}"`);
  }

  let rng = prand.mersenne.fromState(draft.rngState);

  for (const player of draft.players) {
    if (player.policyPool.length < 2) {
      throw new Error(
        `Player "${player.id}" has ${player.policyPool.length} policies in pool, need at least 2`,
      );
    }

    // Shuffle and pick 2
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

  draft.rngState = extractRngState(rng);

  // Transition to main phase
  draft.phase = "main";
  draft.seedingState = undefined;
  draft.turn.activePlayerId = draft.turnOrder[0];
  draft.turn.round = 1;
  draft.turn.actionPointsRemaining = getConfigNumber(
    draft,
    "action_points_per_turn",
    3,
  );
  events.push({ type: "phase_changed", from: "seeding", to: "main" });
}
