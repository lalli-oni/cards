import type { Draft } from "immer";
import { produce } from "immer";
import { runStartOfTurn } from "./apply-main";
import {
  extractRngState,
  fromState,
  shuffle,
  type RandomGenerator,
} from "./rng";
import { isFull } from "./grid-helpers";
import {
  advanceSeedingCursor,
  getConfigNumber,
  getPlayerById,
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

  // resolve_pick during seeding (e.g. Scholar's post-policy reorder).
  // May itself transition to main once the queue empties.
  if (action.type === "resolve_pick") {
    return handleSeedingResolvePick(state, action);
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

  const player = getPlayerById(draft, playerId);
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
  if (seeding.currentPlayerId === draft.players[0].id) {
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

  const player = getPlayerById(draft, playerId);
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
    seeding.currentPlayerId = draft.players[0].id;
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
  const player = getPlayerById(draft, playerId);

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
    (seeding.stealTurnIndex + 1) % draft.players.length;
  seeding.currentPlayerId = draft.players[seeding.stealTurnIndex].id;

  // If middle area is empty, determine next step
  if (seeding.middleArea.length === 0) {
    const anyDeckHasCards = draft.players.some((p) => p.seedingDeck.length > 0);
    if (anyDeckHasCards) {
      seeding.step = "seed_draw";
      seeding.currentPlayerId = draft.players[0].id;
      events.push({ type: "seeding_step_changed", step: "seed_draw" });
    } else {
      // Auto-shuffle prospect decks and build main decks
      let rng = fromState(draft.rngState);
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
      seeding.currentPlayerId = draft.players[0].id;
      events.push({ type: "seeding_step_changed", step: nextStep });
    }
  }
}

/** After steal rounds are exhausted: shuffle prospect/market decks, draw main decks, draw starting hands. */
function buildMainDecksAndHands(
  draft: Draft<SeedingGameState>,
  rng: RandomGenerator,
  events: GameEvent[],
): RandomGenerator {
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

  const player = getPlayerById(draft, playerId);

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
      seeding.currentPlayerId = draft.players[0].id;
      events.push({ type: "seeding_step_changed", step: "policy_selection" });
    }
    return;
  }

  placeLocationOnGrid(draft, card as LocationCard, row, col, rotation);
  events.push({ type: "location_placed", row, col, cardId: card.id });

  advanceSeedingCursor(draft, events);

  if (isFull(draft.grid)) {
    seeding.step = "policy_selection";
    seeding.currentPlayerId = draft.players[0].id;
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

  // Assign policies within seeding state (Immer)
  const afterAssign = produce(state, (draft) => {
    draft.actionLog.push(action);

    let rng = fromState(draft.rngState);

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

  // Queue post-policy reorder prompts for players whose policies need them
  // (e.g. Scholar's top-5 reorder). Players are processed in turn order.
  const pendingPicks = afterAssign.players
    .filter((p) => p.activePolicies.some((pol) => pol.definitionId === "scholar"))
    .filter((p) => p.mainDeck.length > 0)
    .map((p) => p.id);

  if (pendingPicks.length > 0) {
    const withQueue = produce(afterAssign, (draft) => {
      draft.seedingState.step = "post_policy_pick";
      draft.seedingState.pendingPostPolicyPicks = pendingPicks;
      draft.seedingState.currentPlayerId = pendingPicks[0];
      openScholarReorderPrompt(draft, pendingPicks[0], events);
    });
    events.push({ type: "seeding_step_changed", step: "post_policy_pick" });
    return { state: withQueue, events };
  }

  return finalizeSeeding(afterAssign, events);
}

/** Open a Scholar-reorder pickPrompt for the given player on the seeding draft. */
function openScholarReorderPrompt(
  draft: Draft<SeedingGameState>,
  playerId: string,
  events: GameEvent[],
): void {
  const player = getPlayerById(draft, playerId);
  const peekCount = Math.min(5, player.mainDeck.length);
  if (peekCount === 0) return;
  const topIds = player.mainDeck.slice(0, peekCount).map((c) => c.id) as [string, ...string[]];
  draft.pickPrompt = {
    playerId,
    options: topIds,
    count: peekCount,
    source: "main_deck",
    ordered: true,
    purpose: "scholar_reorder",
  };
  events.push({
    type: "cards_peeked",
    playerId,
    cardIds: [...topIds],
    source: "main_deck",
  });
}

function handleSeedingResolvePick(
  state: SeedingGameState,
  action: SeedingAction & { type: "resolve_pick" },
): ApplyResult {
  const prompt = state.pickPrompt;
  if (!prompt) {
    throw new Error("resolve_pick during seeding rejected: no pending pick");
  }
  if (prompt.playerId !== action.playerId) {
    throw new Error(
      `resolve_pick during seeding rejected: pending pick is for "${prompt.playerId}", not "${action.playerId}"`,
    );
  }
  if (prompt.purpose !== "scholar_reorder") {
    throw new Error(
      `resolve_pick during seeding only supports "scholar_reorder" prompts (got "${prompt.purpose}")`,
    );
  }

  // Ordered prompts: submission must be a permutation of options.
  const submitted = action.pickedCardIds;
  if (submitted.length !== prompt.options.length) {
    throw new Error(
      `resolve_pick (scholar_reorder): expected ${prompt.options.length} ids, got ${submitted.length}`,
    );
  }
  const expected = new Set(prompt.options);
  const submittedSet = new Set(submitted);
  if (expected.size !== submittedSet.size || ![...expected].every((id) => submittedSet.has(id))) {
    throw new Error(
      `resolve_pick (scholar_reorder): submitted ids must be a permutation of [${prompt.options.join(",")}]`,
    );
  }

  const events: GameEvent[] = [];
  const after = produce(state, (draft) => {
    draft.actionLog.push(action);
    const player = getPlayerById(draft, action.playerId);
    // Splice the top `count` cards out, then put them back in chosen order.
    const removed = player.mainDeck.splice(0, prompt.options.length);
    const lookup = new Map<string, Card>();
    for (const c of removed) lookup.set(c.id, c);
    const reordered = submitted.map((id) => lookup.get(id)!);
    player.mainDeck.unshift(...reordered);
    events.push({
      type: "cards_picked",
      playerId: action.playerId,
      cardIds: [...submitted],
      source: "main_deck",
    });

    // Pop this player from the queue and advance.
    const queue = draft.seedingState.pendingPostPolicyPicks ?? [];
    const idx = queue.indexOf(action.playerId);
    if (idx >= 0) queue.splice(idx, 1);
    draft.pickPrompt = undefined;

    if (queue.length > 0) {
      draft.seedingState.currentPlayerId = queue[0];
      openScholarReorderPrompt(draft, queue[0], events);
    }
  });

  // If the queue is now empty, transition to main.
  const queueEmpty = (after.seedingState.pendingPostPolicyPicks ?? []).length === 0;
  if (queueEmpty) {
    const cleared = produce(after, (draft) => {
      draft.seedingState.pendingPostPolicyPicks = undefined;
    });
    return finalizeSeeding(cleared, events);
  }
  return { state: after, events };
}

/** Build MainGameState + run first-player start-of-turn. Called when seeding completes. */
function finalizeSeeding(
  state: SeedingGameState,
  events: GameEvent[],
): ApplyResult {
  const mainState: MainGameState = {
    config: state.config,
    phase: "main",
    turn: {
      activePlayerId: state.players[0].id,
      round: 1,
      actionPointsRemaining: getConfigNumber(
        state,
        "action_points_per_turn",
        3,
      ),
    },
    players: state.players,
    grid: state.grid,
    market: state.market,
    rngState: state.rngState,
    seed: state.seed,
    actionLog: state.actionLog,
  };

  events.push({ type: "phase_changed", from: "seeding", to: "main" });
  events.push({
    type: "turn_started",
    playerId: state.players[0].id,
    round: 1,
  });

  // Run first player's start-of-turn (gold income, card draw, market population)
  // No listeners fire at game start — no active cards yet. Pass a no-op emit.
  const readyState = produce(mainState, (draft) => {
    runStartOfTurn(draft, (e) => events.push(e), events);
  });

  return { state: readyState, events };
}
