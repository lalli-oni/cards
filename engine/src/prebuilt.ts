import type { Card, Grid, PolicyCard, SetupInput } from "./types";

export interface PrebuiltPlayerInput {
  mainDeck: Card[];
  hand: Card[];
  prospectDeck: Card[];
  marketDeck: Card[];
  activePolicies: PolicyCard[];
  /** Override starting_gold from config for this player. */
  gold?: number;
}

export interface PrebuiltGameInput {
  players: Record<string, PrebuiltPlayerInput>;
  /** Pre-populated grid with locations placed. */
  grid: Grid;
  /** Pre-populated shared market. */
  market?: Card[];
}

/**
 * Build a SetupInput that skips seeding and starts directly in the main phase
 * with pre-constructed decks, a pre-populated grid, and optional market.
 *
 * Use when variant config has `seeding-phase` set to a non-baseline value
 * (e.g. "pre-built"). The caller inspects config and chooses the SetupInput
 * mode — the engine itself does not route based on config.
 */
export function buildPrebuiltSetup(input: PrebuiltGameInput): SetupInput {
  return {
    mode: "main",
    decks: input.players,
    grid: input.grid,
    market: input.market,
  };
}
