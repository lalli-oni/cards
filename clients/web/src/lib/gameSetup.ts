import {
  createInstanceCounter,
  instantiateCards,
  buildPrebuiltSetup,
  type Card,
  type CardDefinition,
  type GameConfig,
  type PlayerDescriptor,
  type PolicyCard,
  type SetupInput,
  type Grid,
  type LocationCard,
} from "cards-engine";
import cardDefsJson from "@library/all.json";

export const DEFAULT_CONFIG: GameConfig = {
  starting_gold: 10,
  grid_padding: 2,
  action_points_per_turn: 3,
  vp_threshold: 50,
  turn_limit: 20,
  seed_draw: 10,
  seed_keep: 8,
  seed_expose: 2,
  seed_main_deck_draw: 15,
  starting_hand_size: 5,
  max_hand_size: 7,
  raze_ap_cost: 3,
  combat_kill_ratio: 2,
};

export function getCardDefinitions(): CardDefinition[] {
  return cardDefsJson as CardDefinition[];
}

export function buildSeedingSetup(
  players: PlayerDescriptor[],
): SetupInput {
  const defs = getCardDefinitions();
  const counter = createInstanceCounter();
  const nonPolicy = defs.filter((d) => d.type !== "policy");
  const policies = defs.filter((d) => d.type === "policy");

  const decks: Record<
    string,
    { seedingDeck: Card[]; policyPool: PolicyCard[] }
  > = {};
  for (const p of players) {
    decks[p.id] = {
      seedingDeck: instantiateCards(nonPolicy, p.id, counter),
      policyPool: instantiateCards(policies, p.id, counter) as PolicyCard[],
    };
  }
  return { mode: "seeding" as const, decks };
}

/**
 * Build a SetupInput that skips seeding and goes straight to main phase.
 * Distributes cards evenly to players: locations go to prospect decks,
 * non-locations split between hand and main deck. Builds a basic grid
 * with locations placed.
 */
export function buildMainSetup(
  players: PlayerDescriptor[],
  config: GameConfig,
): SetupInput {
  const defs = getCardDefinitions();
  const counter = createInstanceCounter();

  const locations = defs.filter((d) => d.type === "location");
  const policies = defs.filter((d) => d.type === "policy");
  const other = defs.filter((d) => d.type !== "location" && d.type !== "policy");

  const handSize = Number(config.starting_hand_size ?? 5);
  const gridPadding = Number(config.grid_padding ?? 2);
  const gridSize = players.length + gridPadding;

  // Build per-player decks
  const playerDecks: Record<string, {
    mainDeck: Card[];
    hand: Card[];
    prospectDeck: Card[];
    marketDeck: Card[];
    activePolicies: PolicyCard[];
  }> = {};

  for (const p of players) {
    const playerLocs = instantiateCards(locations, p.id, counter);
    const playerOther = instantiateCards(other, p.id, counter);
    const playerPolicies = instantiateCards(policies, p.id, counter) as PolicyCard[];

    playerDecks[p.id] = {
      hand: playerOther.splice(0, handSize),
      mainDeck: playerOther,
      prospectDeck: playerLocs,
      marketDeck: [],
      activePolicies: playerPolicies.length > 0 ? [playerPolicies[0]] : [],
    };
  }

  // Build grid with locations placed
  const grid: Grid = [];
  for (let r = 0; r < gridSize; r++) {
    grid.push(
      Array.from({ length: gridSize }, () => ({ location: null, units: [], items: [] })),
    );
  }

  // Place locations from each player's prospect deck onto the grid
  let cellIdx = 0;
  const locsPerPlayer = Math.floor((gridSize * gridSize) / players.length);
  for (const p of players) {
    const deck = playerDecks[p.id];
    const locsToPlace = deck.prospectDeck.splice(0, locsPerPlayer);
    for (const loc of locsToPlace) {
      const r = Math.floor(cellIdx / gridSize);
      const c = cellIdx % gridSize;
      if (r < gridSize) {
        grid[r][c].location = loc as LocationCard;
      }
      cellIdx++;
    }
  }

  return buildPrebuiltSetup({
    players: playerDecks,
    grid,
  });
}
