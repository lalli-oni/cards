import type { Draft } from "immer";
import prand from "pure-rand";
import { extractRngState, shuffle } from "./rng";
import type {
  Card,
  GameEvent,
  LocationCard,
  MainGameState,
  PlayerState,
} from "./types";

/**
 * Draw one card from a player's main deck to their hand.
 * If the main deck is empty, shuffles the discard pile into it first.
 * Returns the drawn card, or null if both are empty.
 */
export function drawOneCard(
  draft: Draft<MainGameState>,
  player: Draft<PlayerState>,
  events: GameEvent[],
): Card | null {
  if (player.mainDeck.length === 0 && player.discardPile.length > 0) {
    let rng = prand.mersenne.fromState(draft.rngState);
    let shuffled: Card[];
    [shuffled, rng] = shuffle(player.discardPile, rng);
    player.mainDeck = shuffled;
    player.discardPile = [];
    draft.rngState = extractRngState(rng) as number[];
    events.push({ type: "deck_shuffled", playerId: player.id, deck: "main" });
  }

  if (player.mainDeck.length === 0) {
    return null;
  }

  const card = player.mainDeck.shift()!;
  player.hand.push(card);
  events.push({ type: "card_drawn", playerId: player.id, count: 1 });
  return card;
}

/**
 * Draw the next non-event card from a player's market deck.
 * Implements the event draw mechanic: events drawn go to the player's hand,
 * keep drawing until a non-event card is found.
 * Returns the non-event card, or null if the market deck is exhausted.
 */
export function drawMarketCard(
  draft: Draft<MainGameState>,
  player: Draft<PlayerState>,
  events: GameEvent[],
): Card | null {
  while (player.marketDeck.length > 0) {
    const card = player.marketDeck.shift()!;
    if (card.type === "event") {
      player.hand.push(card);
      events.push({ type: "card_drawn", playerId: player.id, count: 1 });
    } else {
      return card;
    }
  }
  return null;
}

/**
 * Draw from prospect deck until a location is found.
 * Non-location cards (dilemmas) are handled per rules:
 * for now, pushed to bottom of prospect deck.
 * Returns the location card, or null if no locations remain.
 */
export function drawLocationFromProspect(
  draft: Draft<MainGameState>,
  player: Draft<PlayerState>,
  events: GameEvent[],
): LocationCard | null {
  const nonLocations: Card[] = [];

  while (player.prospectDeck.length > 0) {
    const card = player.prospectDeck.shift()!;
    if (card.type === "location") {
      // Push any non-locations back to bottom of prospect deck
      player.prospectDeck.push(...nonLocations);
      return card as LocationCard;
    }
    nonLocations.push(card);
  }

  // No locations found — put non-locations back
  player.prospectDeck.push(...nonLocations);
  return null;
}
